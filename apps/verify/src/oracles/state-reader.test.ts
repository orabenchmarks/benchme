import { VERIFIER_SIG_HEADER, WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, verifyVerifierHeader, verifyWorkspaceHeader } from "@benchme/core";
import { describe, expect, it } from "vitest";
import { HttpWorkspaceStateReader, UnknownAppError } from "./state-reader.js";

const SECRET = "gateway-secret-for-tests";
const WS = "ws_0123456789ab";

/** A fetch that records what it was asked and answers with `body`. */
function recordingFetch(body: unknown, status = 200) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(body === undefined ? "" : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { impl, calls };
}

describe("HttpWorkspaceStateReader", () => {
  it("reads the app on its own address, signed for the workspace as the gateway signs and, beside it, as the verifier", async () => {
    const f = recordingFetch([{ no: "SO-1" }]);
    const reader = new HttpWorkspaceStateReader({ warehouse: "http://warehouse:3000/" }, SECRET, f.impl);
    expect(await reader.get(WS, "warehouse", "/api/v1/orders")).toEqual([{ no: "SO-1" }]);
    const [call] = f.calls;
    expect(call!.url).toBe("http://warehouse:3000/api/v1/orders");
    expect(call!.headers[WORKSPACE_HEADER]).toBe(WS);
    expect(verifyWorkspaceHeader(SECRET, WS, call!.headers[WORKSPACE_SIG_HEADER] ?? "")).toBe(true);
    // The signature a site leaves out of its ledger, and shows its ledger for.
    expect(verifyVerifierHeader(SECRET, WS, call!.headers[VERIFIER_SIG_HEADER] ?? "")).toBe(true);
  });

  it("reads nothing there as null, and refuses an app it was never given", async () => {
    expect(await new HttpWorkspaceStateReader({ warehouse: "http://warehouse:3000" }, SECRET, recordingFetch({ error: "NOT_FOUND" }, 404).impl).get(WS, "warehouse", "/api/v1/orders/SO-9")).toBeNull();
    await expect(new HttpWorkspaceStateReader({}, SECRET, recordingFetch([]).impl).get(WS, "nowhere", "/x")).rejects.toBeInstanceOf(UnknownAppError);
    await expect(new HttpWorkspaceStateReader({ warehouse: "http://warehouse:3000" }, SECRET, recordingFetch({ error: "boom" }, 500).impl).get(WS, "warehouse", "/x")).rejects.toThrow(/500/);
  });
});
