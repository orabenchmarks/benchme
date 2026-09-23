import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, signWorkspaceHeader } from "@benchme/core";

/**
 * Reads one app's live REST state, scoped to a workspace. The `state` oracle
 * uses this — never a direct DB read — so the check proves what a real caller
 * of the app would see, the same door an agent used to produce the state.
 */
export interface WorkspaceStateReader {
  /**
   * GETs `path` (a list or detail route) on `app`. A 404 (no such row) or any
   * empty-body response resolves to `null` rather than throwing — the oracle
   * treats "nothing there" as a normal, checkable outcome; anything else that
   * goes wrong (unknown app, network failure, 5xx) throws.
   */
  get(workspaceId: string, app: string, path: string): Promise<unknown>;
}

export class UnknownAppError extends Error {
  constructor(readonly app: string) {
    super(`no such app "${app}" in APP_TARGETS`);
    this.name = "UnknownAppError";
  }
}

/**
 * Calls each target app directly at its in-cluster URL (APP_TARGETS — the
 * same map the gateway uses), signing the workspace header the same way the
 * gateway does: apps trust nothing else, so a check reader must prove it too.
 */
export class HttpWorkspaceStateReader implements WorkspaceStateReader {
  constructor(
    private readonly appTargets: Record<string, string>,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async get(workspaceId: string, app: string, path: string): Promise<unknown> {
    const base = this.appTargets[app];
    if (!base) throw new UnknownAppError(app);
    const res = await this.fetchImpl(`${base.replace(/\/+$/, "")}${path}`, {
      headers: {
        [WORKSPACE_HEADER]: workspaceId,
        [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(this.secret, workspaceId),
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${app}${path} → ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    const text = await res.text();
    return text.length === 0 ? null : JSON.parse(text);
  }
}
