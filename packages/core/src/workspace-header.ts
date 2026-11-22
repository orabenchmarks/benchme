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

/**
 * The verifier reads an app's state on the app's own address, with the signed workspace header like the gateway.
 * This second signature says the read is the verifier's and not a visitor's: an app leaves such a read out of its
 * change ledger, and shows the ledger to nobody else. Only a holder of the gateway secret can make one, and the
 * gateway signs none, so nothing a client sends through it can pass for the verifier.
 */
export const VERIFIER_SIG_HEADER = "x-benchme-verifier-sig";

export function signVerifierHeader(secret: string, workspaceId: string): string {
  return createHmac("sha256", secret).update(`verifier:${workspaceId}`).digest("hex");
}

export function verifyVerifierHeader(secret: string, workspaceId: string, signature: string): boolean {
  const expected = Buffer.from(signVerifierHeader(secret, workspaceId));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
