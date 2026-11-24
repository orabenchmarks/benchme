import { describe, expect, it } from "vitest";
import { DoorSet } from "./doors.js";
import { DOORS_HEADER, DOORS_SIG_HEADER, doorsFromHeaders, doorsHeaders, signDoorsHeader, signVerifierHeader, signWorkspaceHeader, verifyDoorsHeader, verifyVerifierHeader, verifyWorkspaceHeader } from "./workspace-header.js";

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

describe("doors header", () => {
  const ws = "ws_0123456789ab";
  const other = "ws_ba9876543210";

  it("verifies its own signature and rejects another workspace's, another list's, another secret's, or an empty one", () => {
    const sig = signDoorsHeader("gateway-secret", ws, "page,webmcp");
    expect(verifyDoorsHeader("gateway-secret", ws, "page,webmcp", sig)).toBe(true);
    expect(verifyDoorsHeader("gateway-secret", other, "page,webmcp", sig)).toBe(false);
    expect(verifyDoorsHeader("gateway-secret", ws, "page,rest,mcp,webmcp", sig)).toBe(false);
    expect(verifyDoorsHeader("other-secret", ws, "page,webmcp", sig)).toBe(false);
    expect(verifyDoorsHeader("gateway-secret", ws, "page,webmcp", "")).toBe(false);
  });

  // The gateway signs the workspace header (and an app trusts nothing else), so neither of its other signatures may pass for this one.
  it("is neither the workspace signature nor the verifier's", () => {
    expect(verifyDoorsHeader("gateway-secret", ws, "", signWorkspaceHeader("gateway-secret", ws))).toBe(false);
    expect(verifyDoorsHeader("gateway-secret", ws, "", signVerifierHeader("gateway-secret", ws))).toBe(false);
  });

  it("reads back what the gateway sends, as the app sees it", () => {
    const sent = doorsHeaders("gateway-secret", ws, DoorSet.of(["webmcp", "page"]));
    expect(sent[DOORS_HEADER]).toBe("page,webmcp");
    const read = (secret: string, id: string, list: string | undefined, sig: string | undefined) => doorsFromHeaders(secret, id, list, sig)?.toString() ?? null;
    expect(read("gateway-secret", ws, sent[DOORS_HEADER], sent[DOORS_SIG_HEADER])).toBe("page,webmcp");
    // Neither header: a gateway from before doors, which served every door.
    expect(read("gateway-secret", ws, undefined, undefined)).toBe("page,rest,mcp,webmcp");
    // Forged, replayed onto another workspace, a list without its signature, a signature without its list: refused.
    expect(read("gateway-secret", ws, "page,rest,mcp,webmcp", sent[DOORS_SIG_HEADER])).toBeNull();
    expect(read("gateway-secret", other, sent[DOORS_HEADER], sent[DOORS_SIG_HEADER])).toBeNull();
    expect(read("gateway-secret", ws, sent[DOORS_HEADER], undefined)).toBeNull();
    expect(read("gateway-secret", ws, undefined, sent[DOORS_SIG_HEADER])).toBeNull();
  });
});
