/** A fresh shops-v1 workspace per test, minted the way a task's prompt tells an agent to mint one. */

export type Workspace = { id: string; apps: Record<string, string> };

export async function mintWorkspace(baseUrl: string, operatorKey: string): Promise<Workspace> {
  const res = await fetch(`${baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-benchme-operator-key": operatorKey },
    body: JSON.stringify({ scenario: "shops-v1" }),
  });
  const text = await res.text();
  if (res.status !== 201) throw new Error(`POST ${baseUrl}/api/workspaces answered ${res.status}: ${text.slice(0, 300)}`);
  const w = JSON.parse(text) as { id?: string; urls?: { apps?: Record<string, string> } };
  if (!w.id || !w.urls?.apps) throw new Error(`POST ${baseUrl}/api/workspaces answered without id and urls.apps: ${text.slice(0, 300)}`);
  return { id: w.id, apps: w.urls.apps };
}
