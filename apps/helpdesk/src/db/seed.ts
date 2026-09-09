import { withTx, type Pool } from "@benchme/core";
import type { ScenarioRows } from "@benchme/scenarios";

async function bulk(client: { query: (sql: string, params: unknown[]) => Promise<unknown> }, table: string, columns: string[], rows: unknown[][]) {
  if (rows.length === 0) return;
  const perRow = columns.length;
  const chunk = Math.floor(60_000 / perRow);
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const placeholders = slice.map((_, r) => `(${columns.map((__, c) => `$${r * perRow + c + 1}`).join(",")})`).join(",");
    await client.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${placeholders}`, slice.flat());
  }
}

/** Materialise a scenario's helpdesk rows under one workspace, atomically. Idempotent: a re-seed replaces. */
export async function seedHelpdesk(pool: Pool, ws: string, rows: ScenarioRows): Promise<void> {
  const h = rows.helpdesk;
  await withTx(pool, async (c) => {
    for (const t of ["comments", "tickets", "agents", "sla_policies", "counters", "sessions", "verification_codes", "users"]) {
      await c.query(`DELETE FROM helpdesk.${t} WHERE workspace_id = $1`, [ws]);
    }
    await bulk(c, "helpdesk.agents", ["workspace_id", "code", "name", "team"], h.agents.map((a) => [ws, a.code, a.name, a.team]));
    await bulk(c, "helpdesk.sla_policies", ["workspace_id", "priority", "respond_hours", "resolve_hours"], h.slaPolicies.map((s) => [ws, s.priority, s.respondHours, s.resolveHours]));
    await bulk(
      c,
      "helpdesk.tickets",
      ["workspace_id", "ticket_no", "subject", "body", "requester", "priority", "status", "assignee_code", "opened_at", "updated_at", "resolved_at"],
      h.tickets.map((t) => [ws, t.ticketNo, t.subject, t.body, t.requester, t.priority, t.status, t.assigneeCode, t.openedAt, t.resolvedAt ?? t.openedAt, t.resolvedAt]),
    );
    await bulk(c, "helpdesk.comments", ["workspace_id", "ticket_no", "seq", "author", "body", "internal", "created_at"], h.comments.map((x) => [ws, x.ticketNo, x.seq, x.author, x.body, x.internal, x.createdAt]));
  });
}
