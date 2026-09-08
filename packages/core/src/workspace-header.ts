import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The gateway binds a workspace from the URL prefix and forwards it to the app
 * as a header, signed with the shared gateway secret, so an app only ever trusts
 * a workspace id that came through the gateway (never a client-supplied one).
 */
export const WORKSPACE_HEADER = "x-benchme-workspace";
export const WORKSPACE_SIG_HEADER = "x-benchme-workspace-sig";
/** The mount prefix the gateway stripped, so apps render absolute links and cookie paths. */
export const FORWARDED_PREFIX_HEADER = "x-forwarded-prefix";

export function signWorkspaceHeader(secret: string, workspaceId: string): string {
  return createHmac("sha256", secret).update(workspaceId).digest("hex");
}

export function verifyWorkspaceHeader(secret: string, workspaceId: string, signature: string): boolean {
  const expected = Buffer.from(signWorkspaceHeader(secret, workspaceId));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
