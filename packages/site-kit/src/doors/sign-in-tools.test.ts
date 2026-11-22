import { describe, expect, it } from "vitest";
import { AuthService } from "../auth-service.js";
import { ToolRegistry } from "../tool-registry.js";
import { toolInputJsonSchema } from "../tool-schema.js";
import { MemoryUsersRepo } from "../users-repo.js";
import { CallerScope } from "./caller.js";
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

  it("refuse to run outside a door", async () => {
    const whoami = tools.list().find((t) => t.name === "whoami")!;
    await expect(whoami.handler({}, { workspaceId: "ws_0123456789ab" })).rejects.toThrow(/outside a door/);
  });
});
