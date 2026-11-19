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

/** Materialise a scenario's home rows under one workspace, atomically. Idempotent: a re-seed replaces. */
export async function seedHomes(pool: Pool, ws: string, rows: ScenarioRows): Promise<void> {
  const h = rows.homes;
  await withTx(pool, async (c) => {
    for (const t of ["viewings", "agent_days", "listings", "agents", "counters", "sessions", "verification_codes", "users"]) {
      await c.query(`DELETE FROM homes.${t} WHERE workspace_id = $1`, [ws]);
    }
    await bulk(c, "homes.agents", ["workspace_id", "code", "name", "city", "email"], h.agents.map((a) => [ws, a.code, a.name, a.city, a.email]));
    await bulk(
      c,
      "homes.listings",
      ["workspace_id", "code", "city", "neighbourhood", "address", "type", "price_cents", "beds", "baths", "area_sqm", "year_built", "features", "monthly_fee_cents", "annual_tax_cents", "status", "listed_on", "agent_code", "description"],
      h.listings.map((l) => [ws, l.code, l.city, l.neighbourhood, l.address, l.type, l.priceCents, l.beds, l.baths, l.areaSqm, l.yearBuilt, l.features, l.monthlyFeeCents, l.annualTaxCents, l.status, l.listedOn, l.agentCode, l.description]),
    );
    await bulk(c, "homes.agent_days", ["workspace_id", "agent_code", "work_date", "from_time", "until_time"], h.agentDays.map((d) => [ws, d.agentCode, d.date, d.from, d.until]));
    await bulk(
      c,
      "homes.viewings",
      ["workspace_id", "viewing_no", "listing_code", "agent_code", "slot_date", "slot_time", "viewer_name", "viewer_email", "status", "created_at"],
      h.viewings.map((v) => [ws, v.viewingNo, v.listingCode, v.agentCode, v.date, v.time, v.viewerName, v.viewerEmail, v.status, v.createdAt]),
    );
  });
}
