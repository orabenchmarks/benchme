import { z } from "zod";
import { CODE_ATTEMPTS } from "../accounts-schema.js";
import type { AuthService } from "../auth-service.js";
import type { ToolRegistry } from "../tool-registry.js";
import type { Caller, CallerScope } from "./caller.js";

export type SignInToolsDeps = { auth: AuthService; callers: CallerScope };

/** The names of the tools every site with accounts carries, in the order a newcomer calls them. */
export const SIGN_IN_TOOLS = ["sign_up", "verify_email", "sign_in", "sign_out", "whoami"] as const;

/**
 * Signing up and in, as tools: what the sign-up, verify and sign-in pages do,
 * through the same AuthService, so an agent that only has a site's tools is
 * not stopped at the first write. Registered on the site's own registry, so
 * the MCP server lists them and the pages' WebMCP bridge registers them.
 *
 * Nothing here is easier than the pages: the code still goes to the workspace
 * inbox and has to be read there, and the password is still checked. The
 * session is kept by the request's carrier (an MCP session's id, or the
 * browser's cookie), so no token is handed to the caller to pass around.
 */
export function registerSignInTools<C extends { workspaceId: string }>(tools: ToolRegistry<C>, d: SignInToolsDeps): ToolRegistry<C> {
  const caller = (): Caller => {
    const c = d.callers.current();
    if (!c) throw new Error("a sign-in tool was called outside a door: no caller is in scope");
    return c;
  };
  return tools
    .register({
      name: "sign_up",
      description: "Create an account on this site. A 6-digit verification code is mailed to the email address: read it in the workspace inbox (the mail app), then call verify_email. Signing up again with an email that is not verified yet mails a new code. Writes on this site need a signed-in account.",
      input: { name: z.string().describe("the account holder's name"), email: z.string().describe("the account's email address"), password: z.string().describe("8 characters or more") },
      handler: async (a, c) => {
        const user = await d.auth.signup(c.workspaceId, a.email, a.password, a.name);
        return { email: user.email, verified: false, next: `a verification code was mailed to ${user.email}: read it in the workspace inbox, then call verify_email` };
      },
    })
    .register({
      name: "verify_email",
      description: `Verify a new account's email address with the 6-digit code mailed to it at sign-up. Then call sign_in. A code can be tried ${CODE_ATTEMPTS} times: after that it no longer works, and only a new code does (call sign_up again).`,
      input: { email: z.string(), code: z.string().describe("the 6-digit code from the verification mail") },
      handler: async (a, c) => {
        await d.auth.verify(c.workspaceId, a.email, a.code);
        return { email: a.email.trim().toLowerCase(), verified: true, next: "call sign_in" };
      },
    })
    .register({
      name: "sign_in",
      description: "Sign in to a verified account. The sign-in stays with this connection (or, in a browser, with the site's pages), so the site's other tools then act as the account.",
      input: { email: z.string(), password: z.string() },
      handler: async (a, c) => {
        await caller().session.signIn((bindTo) => d.auth.login(c.workspaceId, a.email, a.password, bindTo));
        return { signedIn: true, email: a.email.trim().toLowerCase() };
      },
    })
    .register({
      name: "sign_out",
      description: "Sign out of the account this connection (or browser) is signed in to.",
      input: {},
      handler: async (_a, c) => {
        await caller().session.signOut((token) => d.auth.logout(c.workspaceId, token));
        return { signedIn: false };
      },
    })
    .register({
      name: "whoami",
      description: "Whether this connection (or browser) is signed in, and to which account.",
      input: {},
      handler: async () => {
        const email = await caller().actor();
        return email ? { signedIn: true, email } : { signedIn: false };
      },
    });
}
