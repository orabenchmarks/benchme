import { describe, expect, it } from "vitest";
import { signWorkspaceHeader, verifyWorkspaceHeader } from "./workspace-header.js";

describe("workspace header signature", () => {
  it("verifies its own signature and rejects a tampered id, secret, or empty signature", () => {
    const sig = signWorkspaceHeader("gateway-secret", "ws_0123456789ab");
    expect(verifyWorkspaceHeader("gateway-secret", "ws_0123456789ab", sig)).toBe(true);
    expect(verifyWorkspaceHeader("gateway-secret", "ws_0123456789ac", sig)).toBe(false);
    expect(verifyWorkspaceHeader("other-secret", "ws_0123456789ab", sig)).toBe(false);
    expect(verifyWorkspaceHeader("gateway-secret", "ws_0123456789ab", "")).toBe(false);
  });
});
