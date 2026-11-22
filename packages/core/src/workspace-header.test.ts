import { describe, expect, it } from "vitest";
import { signVerifierHeader, signWorkspaceHeader, verifyVerifierHeader, verifyWorkspaceHeader } from "./workspace-header.js";

describe("workspace header signature", () => {
  it("verifies its own signature and rejects a tampered id, secret, or empty signature", () => {
    const sig = signWorkspaceHeader("gateway-secret", "ws_0123456789ab");
    expect(verifyWorkspaceHeader("gateway-secret", "ws_0123456789ab", sig)).toBe(true);
    expect(verifyWorkspaceHeader("gateway-secret", "ws_0123456789ac", sig)).toBe(false);
    expect(verifyWorkspaceHeader("other-secret", "ws_0123456789ab", sig)).toBe(false);
    expect(verifyWorkspaceHeader("gateway-secret", "ws_0123456789ab", "")).toBe(false);
  });
});

describe("verifier signature", () => {
  it("verifies its own signature and rejects another workspace's, another secret's, or an empty one", () => {
    const sig = signVerifierHeader("gateway-secret", "ws_0123456789ab");
    expect(verifyVerifierHeader("gateway-secret", "ws_0123456789ab", sig)).toBe(true);
    expect(verifyVerifierHeader("gateway-secret", "ws_0123456789ac", sig)).toBe(false);
    expect(verifyVerifierHeader("other-secret", "ws_0123456789ab", sig)).toBe(false);
    expect(verifyVerifierHeader("gateway-secret", "ws_0123456789ab", "")).toBe(false);
  });

  // The gateway signs the workspace header on every proxied request, so that signature must never open the verifier's door.
  it("is not the workspace signature: what the gateway forwards does not pass for the verifier", () => {
    expect(verifyVerifierHeader("gateway-secret", "ws_0123456789ab", signWorkspaceHeader("gateway-secret", "ws_0123456789ab"))).toBe(false);
  });
});
