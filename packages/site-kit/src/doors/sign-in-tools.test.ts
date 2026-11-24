import { describe, expect, it } from "vitest";
import { AuthService } from "../auth-service.js";
import { authPages } from "../html.js";
import { ToolRegistry } from "../tool-registry.js";
import { toolInputJsonSchema } from "../tool-schema.js";
import { MemoryUsersRepo } from "../users-repo.js";
import { CallerScope } from "./caller.js";
import { SignInRequired } from "./sign-in.js";
import { SIGN_IN_TOOLS, registerSignInTools } from "./sign-in-tools.js";

const auth = new AuthService({ users: new MemoryUsersRepo(), mailer: { deliver: async () => undefined }, sessionTtlSeconds: 60, tokenPrefix: "t", verification: { subject: "s", body: (code) => code } });
const tools = registerSignInTools(new ToolRegistry<{ workspaceId: string }>(), { auth, callers: new CallerScope() });

describe("the sign-in tools", () => {
  it("are the five every site with accounts carries, in the order a newcomer calls them", () => {
    expect(tools.list().map((t) => t.name)).toEqual([...SIGN_IN_TOOLS]);
  });

  // tools/mcp-tool-schemas.mjs holds each app's own tools to this; these are added by the kit, so they are held to it here.
  it("advertise input schemas with no \"$ref\", which some agent clients cannot follow", () => {
    for (const tool of tools.list()) expect([tool.name, JSON.stringify(toolInputJsonSchema(tool)).includes("$ref")]).toEqual([tool.name, false]);
  });

  it("take no session token as an argument: the sign-in is the connection's, not something to pass around", () => {
    const args = tools.list().flatMap((t) => Object.keys(t.input));
    expect([...new Set(args)].sort()).toEqual(["code", "email", "name", "password"]);
  });

  // In a workspace whose people have mailboxes of their own, a code mailed to one of them never reaches the
  // workspace inbox. So no door promises that it does: each says the inbox shows the code for an address new to the
  // workspace, the condition that holds whatever the workspace's mailboxes are.
  it("tell a newcomer, at every door, that the workspace inbox shows the code mailed to an address new to the workspace", async () => {
    const signUp = tools.list().find((t) => t.name === "sign_up")!;
    const reply = (await signUp.handler({ name: "N", email: "newcomer@elsewhere.example", password: "correct-horse-9" }, { workspaceId: "ws_0123456789ab" })) as { next: string };
    const doors = {
      tool: signUp.description,
      toolReply: reply.next,
      signUpPage: authPages.signup("/p"),
      verifyPage: authPages.verify("/p", "newcomer@elsewhere.example"),
      mcpRefusal: new SignInRequired("mcp").message,
      webmcpRefusal: new SignInRequired("webmcp").message,
    };
    for (const [door, said] of Object.entries(doors)) {
      expect([door, /new to the workspace/.test(said)]).toEqual([door, true]);
      expect([door, /read it in the workspace inbox|mailed to the workspace inbox|sent to the workspace inbox/.test(said)]).toEqual([door, false]);
    }
  });

  // The tools take the email they verify; the page must too. A hidden email field, empty when the page was reached
  // again after leaving for the inbox, made every code on it fail (production pilot c53d5c6a).
  it("put the email on the verify page as a field a reader sees and fills, filled in when known, and say what a second sign-up does", () => {
    const known = authPages.verify("/p", "newcomer@elsewhere.example");
    const blank = authPages.verify("/p", "");
    expect(known).toContain('<input name="email" type="email" required value="newcomer@elsewhere.example">');
    expect(blank).toContain('<input name="email" type="email" required value="">');
    expect(blank).toContain("Enter the email you signed up with");
    for (const page of [known, blank]) expect(page).not.toMatch(/type="hidden"/);
    const verifyTool = tools.list().find((t) => t.name === "verify_email")!.description;
    const signUpTool = tools.list().find((t) => t.name === "sign_up")!.description;
    for (const said of [known, verifyTool, signUpTool]) expect(said).toMatch(/replaces the earlier code|the earlier one stops working/);
  });

  it("refuse to run outside a door", async () => {
    const whoami = tools.list().find((t) => t.name === "whoami")!;
    await expect(whoami.handler({}, { workspaceId: "ws_0123456789ab" })).rejects.toThrow(/outside a door/);
  });
});
