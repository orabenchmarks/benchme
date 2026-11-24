import { createHmac, timingSafeEqual } from "node:crypto";
import { DoorSet, splitList } from "./doors.js";

/**
 * The gateway binds a workspace from the URL prefix and forwards it to the app
 * as a header, signed with the shared gateway secret, so an app only ever trusts
 * a workspace id that came through the gateway (never a client-supplied one).
 */
export const WORKSPACE_HEADER = "x-benchme-workspace";
export const WORKSPACE_SIG_HEADER = "x-benchme-workspace-sig";
/** The mount prefix the gateway stripped, so apps render absolute links and cookie paths. */
export const FORWARDED_PREFIX_HEADER = "x-forwarded-prefix";

const hmac = (secret: string, message: string): string => createHmac("sha256", secret).update(message).digest("hex");

/** Whether `given` is `expected`, compared in constant time. */
function same(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signWorkspaceHeader(secret: string, workspaceId: string): string {
  return hmac(secret, workspaceId);
}

export function verifyWorkspaceHeader(secret: string, workspaceId: string, signature: string): boolean {
  return same(signWorkspaceHeader(secret, workspaceId), signature);
}

/**
 * The verifier reads an app's state on the app's own address, with the signed workspace header like the gateway.
 * This second signature says the read is the verifier's and not a visitor's: an app leaves such a read out of its
 * change ledger, and shows the ledger to nobody else. Only a holder of the gateway secret can make one, and the
 * gateway signs none, so nothing a client sends through it can pass for the verifier.
 */
export const VERIFIER_SIG_HEADER = "x-benchme-verifier-sig";

export function signVerifierHeader(secret: string, workspaceId: string): string {
  return hmac(secret, `verifier:${workspaceId}`);
}

export function verifyVerifierHeader(secret: string, workspaceId: string, signature: string): boolean {
  return same(signVerifierHeader(secret, workspaceId), signature);
}

/**
 * The doors the gateway serves a request's workspace through, forwarded beside
 * the workspace header as a comma list (`page,webmcp`) and signed with the
 * gateway secret over the workspace id and the list. The gateway decides the
 * set and replaces whatever a client sent under these names; the signature
 * binds the list to its workspace, so one made for a workspace opens no other.
 */
export const DOORS_HEADER = "x-benchme-doors";
export const DOORS_SIG_HEADER = "x-benchme-doors-sig";

export function signDoorsHeader(secret: string, workspaceId: string, doors: string): string {
  return hmac(secret, `doors:${workspaceId}:${doors}`);
}

export function verifyDoorsHeader(secret: string, workspaceId: string, doors: string, signature: string): boolean {
  return same(signDoorsHeader(secret, workspaceId, doors), signature);
}

/** The two headers that carry `doors` for `workspaceId` from the gateway to an app. */
export function doorsHeaders(secret: string, workspaceId: string, doors: DoorSet): Record<typeof DOORS_HEADER | typeof DOORS_SIG_HEADER, string> {
  const list = doors.toString();
  return { [DOORS_HEADER]: list, [DOORS_SIG_HEADER]: signDoorsHeader(secret, workspaceId, list) };
}

/**
 * The doors an app serves a request through, read from the gateway's two
 * headers. Neither sent is a gateway older than doors, which served every
 * door: so does the app. Anything else must be a list signed for this
 * workspace, or it is null, and the request is refused as one that did not
 * come through the gateway.
 */
export function doorsFromHeaders(secret: string, workspaceId: string, list: string | undefined, signature: string | undefined): DoorSet | null {
  if (list === undefined && signature === undefined) return DoorSet.ALL;
  if (list === undefined || signature === undefined || !verifyDoorsHeader(secret, workspaceId, list, signature)) return null;
  return DoorSet.read(splitList(list));
}
