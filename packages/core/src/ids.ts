import { randomBytes } from "node:crypto";

const WORKSPACE_ID = /^ws_[0-9a-f]{12}$/;

/** A workspace id: "ws_" + 12 hex from a CSPRNG (48 bits: unguessable, short enough for a URL). */
export function newWorkspaceId(): string {
  return `ws_${randomBytes(6).toString("hex")}`;
}

export function isWorkspaceId(value: string): boolean {
  return WORKSPACE_ID.test(value);
}
