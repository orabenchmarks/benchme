import { withTx, type Pool, type PoolClient } from "@benchme/core";
import {
  homeSlotsOf,
  homeViewingProblem,
  searchHomeListings,
  type HomeAgent,
  type HomeAgentDay,
  type HomeListing,
  type HomeListingQuery,
  type HomeSlot,
  type HomeViewing,
  type HomeViewingRequest,
  type HomeViewingStatus,
} from "@benchme/scenarios";
import { DomainError } from "@benchme/site-kit";

export type ListingDetail = HomeListing & { agent: HomeAgent };
export type AgentDetail = HomeAgent & { days: HomeAgentDay[] };
export type ViewingRow = HomeViewing & { cancelledAt: string | null };
export type ViewingFilter = { email?: string; listing?: string; agent?: string; status?: HomeViewingStatus; cursor?: string; limit: number };
/** `from` is "YYYY-MM-DDTHH:MM": slots starting at or after it. */
export type SlotFilter = { from?: string; freeOnly?: boolean };

/**
 * Listings, agents, the agents' viewing days and viewing requests. Searches
 * and the request rules are @benchme/scenarios' home rules — the same
 * functions the answer keys are derived with — the rules applied here inside
 * the write's transaction.
 */
export interface HomesRepo {
  cities(ws: string): Promise<{ city: string; listings: number; active: number }[]>;
  search(ws: string, q: HomeListingQuery): Promise<HomeListing[]>;
  getListing(ws: string, code: string): Promise<ListingDetail | null>;
  listAgents(ws: string, city?: string): Promise<HomeAgent[]>;
  getAgent(ws: string, code: string): Promise<AgentDetail | null>;
  /** The listing agent's slots in the window, in time order. */
  slots(ws: string, listingCode: string, f: SlotFilter): Promise<HomeSlot[]>;
  listViewings(ws: string, f: ViewingFilter): Promise<{ items: ViewingRow[]; nextCursor: string | null }>;
  getViewing(ws: string, viewingNo: string): Promise<ViewingRow | null>;
  requestViewing(ws: string, input: HomeViewingRequest): Promise<ViewingRow>;
  /** requested → cancelled; a cancelled request stays cancelled. */
  cancelViewing(ws: string, viewingNo: string): Promise<ViewingRow>;
}

type LRow = {
  code: string; city: string; neighbourhood: string; address: string; type: HomeListing["type"]; price_cents: number; beds: number; baths: number; area_sqm: number; year_built: number;
  features: string[]; monthly_fee_cents: number; annual_tax_cents: number; status: HomeListing["status"]; listed_on: string; agent_code: string; description: string;
};
type ARow = { code: string; name: string; city: string; email: string };
type DRow = { agent_code: string; work_date: string; from_time: string; until_time: string };
type VRow = {
  viewing_no: string; listing_code: string; agent_code: string; slot_date: string; slot_time: string; viewer_name: string; viewer_email: string; status: HomeViewingStatus; created_at: Date; cancelled_at: Date | null;
};

const toListing = (r: LRow): HomeListing => ({
  code: r.code, city: r.city, neighbourhood: r.neighbourhood, address: r.address, type: r.type, priceCents: r.price_cents, beds: r.beds, baths: r.baths, areaSqm: r.area_sqm, yearBuilt: r.year_built,
  features: r.features, monthlyFeeCents: r.monthly_fee_cents, annualTaxCents: r.annual_tax_cents, status: r.status, listedOn: r.listed_on, agentCode: r.agent_code, description: r.description,
});
const toAgent = (r: ARow): HomeAgent => ({ code: r.code, name: r.name, city: r.city, email: r.email });
const toDay = (r: DRow): HomeAgentDay => ({ agentCode: r.agent_code, date: r.work_date, from: r.from_time, until: r.until_time });
const toViewing = (r: VRow): ViewingRow => ({
  viewingNo: r.viewing_no, listingCode: r.listing_code, agentCode: r.agent_code, date: r.slot_date, time: r.slot_time, viewerName: r.viewer_name, viewerEmail: r.viewer_email, status: r.status,
  createdAt: r.created_at.toISOString(), cancelledAt: r.cancelled_at?.toISOString() ?? null,
});

// DATE columns read as text: node-postgres turns a DATE into a local-midnight Date, which shifts a day in any zone west of UTC.
const LISTING_COLS = "code, city, neighbourhood, address, type, price_cents, beds, baths, area_sqm, year_built, features, monthly_fee_cents, annual_tax_cents, status, to_char(listed_on, 'YYYY-MM-DD') AS listed_on, agent_code, description";
const DAY_COLS = "agent_code, to_char(work_date, 'YYYY-MM-DD') AS work_date, from_time, until_time";
const VIEWING_COLS = "viewing_no, listing_code, agent_code, to_char(slot_date, 'YYYY-MM-DD') AS slot_date, slot_time, viewer_name, viewer_email, status, created_at, cancelled_at";
/** A slot that is simply taken is 409; anything the viewer can fix by asking for something else is 422. */
const statusOf = (code: string) => (code === "SLOT_TAKEN" ? 409 : 422);

export class PgHomesRepo implements HomesRepo {
  constructor(private readonly pool: Pool) {}

  async cities(ws: string) {
    const r = await this.pool.query<{ city: string; listings: string; active: string }>(
      "SELECT city, count(*) AS listings, count(*) FILTER (WHERE status = 'active') AS active FROM homes.listings WHERE workspace_id = $1 GROUP BY city ORDER BY city",
      [ws],
    );
    return r.rows.map((x) => ({ city: x.city, listings: Number(x.listings), active: Number(x.active) }));
  }

  async search(ws: string, q: HomeListingQuery): Promise<HomeListing[]> {
    const params: unknown[] = [ws];
    let where = "workspace_id = $1";
    if (q.city) {
      params.push(q.city.trim().toLowerCase());
      where += " AND lower(city) = $2";
    }
    const rows = (await this.pool.query<LRow>(`SELECT ${LISTING_COLS} FROM homes.listings WHERE ${where}`, params)).rows.map(toListing);
    return searchHomeListings(rows, q);
  }

  async getListing(ws: string, code: string): Promise<ListingDetail | null> {
    const l = (await this.pool.query<LRow>(`SELECT ${LISTING_COLS} FROM homes.listings WHERE workspace_id = $1 AND code = $2`, [ws, code])).rows[0];
    if (!l) return null;
    const a = (await this.pool.query<ARow>("SELECT * FROM homes.agents WHERE workspace_id = $1 AND code = $2", [ws, l.agent_code])).rows[0] as ARow;
    return { ...toListing(l), agent: toAgent(a) };
  }

  async listAgents(ws: string, city?: string): Promise<HomeAgent[]> {
    const r = city
      ? await this.pool.query<ARow>("SELECT * FROM homes.agents WHERE workspace_id = $1 AND lower(city) = $2 ORDER BY code", [ws, city.trim().toLowerCase()])
      : await this.pool.query<ARow>("SELECT * FROM homes.agents WHERE workspace_id = $1 ORDER BY code", [ws]);
    return r.rows.map(toAgent);
  }

  async getAgent(ws: string, code: string): Promise<AgentDetail | null> {
    const a = (await this.pool.query<ARow>("SELECT * FROM homes.agents WHERE workspace_id = $1 AND code = $2", [ws, code])).rows[0];
    return a ? { ...toAgent(a), days: await this.daysOf(this.pool, ws, code) } : null;
  }

  async slots(ws: string, listingCode: string, f: SlotFilter): Promise<HomeSlot[]> {
    const l = (await this.pool.query<{ agent_code: string }>("SELECT agent_code FROM homes.listings WHERE workspace_id = $1 AND code = $2", [ws, listingCode])).rows[0];
    if (!l) throw new DomainError("UNKNOWN_LISTING", `no listing ${listingCode}`, 404);
    const agentDays = await this.daysOf(this.pool, ws, l.agent_code);
    const viewings = await this.requestedFor(this.pool, ws, l.agent_code, null);
    return homeSlotsOf({ agentDays, viewings }, l.agent_code).filter((s) => (!f.from || `${s.date}T${s.time}` >= f.from) && (!f.freeOnly || s.free));
  }

  async listViewings(ws: string, f: ViewingFilter) {
    const params: unknown[] = [ws, f.limit + 1];
    let where = "workspace_id = $1";
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where += ` AND ${sql.replace("?", `$${params.length}`)}`;
    };
    if (f.email) add("lower(viewer_email) = ?", f.email.trim().toLowerCase());
    if (f.listing) add("listing_code = ?", f.listing);
    if (f.agent) add("agent_code = ?", f.agent);
    if (f.status) add("status = ?", f.status);
    if (f.cursor) add("viewing_no > ?", f.cursor);
    const r = await this.pool.query<VRow>(`SELECT ${VIEWING_COLS} FROM homes.viewings WHERE ${where} ORDER BY viewing_no LIMIT $2`, params);
    const items = r.rows.slice(0, f.limit).map(toViewing);
    return { items, nextCursor: r.rows.length > f.limit ? (items[items.length - 1]?.viewingNo ?? null) : null };
  }

  async getViewing(ws: string, viewingNo: string): Promise<ViewingRow | null> {
    const r = await this.pool.query<VRow>(`SELECT ${VIEWING_COLS} FROM homes.viewings WHERE workspace_id = $1 AND viewing_no = $2`, [ws, viewingNo]);
    return r.rows[0] ? toViewing(r.rows[0]) : null;
  }

  async requestViewing(ws: string, input: HomeViewingRequest): Promise<ViewingRow> {
    const req = { ...input, viewerName: input.viewerName.trim(), viewerEmail: input.viewerEmail.trim().toLowerCase() };
    const viewingNo = await withTx(this.pool, async (c) => {
      const l = (await c.query<LRow>(`SELECT ${LISTING_COLS} FROM homes.listings WHERE workspace_id = $1 AND code = $2`, [ws, req.listingCode])).rows[0];
      if (!l) throw new DomainError("UNKNOWN_LISTING", `no listing ${req.listingCode}`, 404);
      // Locking the agent serialises requests for their slots; the viewer's lock serialises their requests across agents.
      await c.query("SELECT 1 FROM homes.agents WHERE workspace_id = $1 AND code = $2 FOR UPDATE", [ws, l.agent_code]);
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`homes:${ws}:${req.viewerEmail}`]);
      const listing = toListing(l);
      const problem = homeViewingProblem(listing, await this.daysOf(c, ws, l.agent_code), await this.requestedFor(c, ws, l.agent_code, req.viewerEmail), req);
      if (problem) throw new DomainError(problem.code, problem.message, statusOf(problem.code));
      const n = await c.query<{ value: number }>(
        `INSERT INTO homes.counters (workspace_id, name, value) VALUES ($1, 'viewing', 1)
         ON CONFLICT (workspace_id, name) DO UPDATE SET value = homes.counters.value + 1 RETURNING value`,
        [ws],
      );
      const no = `VW-${5000 + (n.rows[0]?.value ?? 0)}`;
      await c.query(
        `INSERT INTO homes.viewings (workspace_id, viewing_no, listing_code, agent_code, slot_date, slot_time, viewer_name, viewer_email, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'requested')`,
        [ws, no, listing.code, listing.agentCode, req.date, req.time, req.viewerName, req.viewerEmail],
      );
      return no;
    });
    // Read back after the commit: getViewing uses the pool, which cannot see the open transaction.
    return (await this.getViewing(ws, viewingNo)) as ViewingRow;
  }

  async cancelViewing(ws: string, viewingNo: string): Promise<ViewingRow> {
    const r = await this.pool.query("UPDATE homes.viewings SET status = 'cancelled', cancelled_at = now() WHERE workspace_id = $1 AND viewing_no = $2 AND status = 'requested'", [ws, viewingNo]);
    if (!r.rowCount) {
      if (!(await this.getViewing(ws, viewingNo))) throw new DomainError("UNKNOWN_VIEWING", `no viewing ${viewingNo}`, 404);
      throw new DomainError("ALREADY_CANCELLED", `viewing ${viewingNo} is already cancelled`, 409);
    }
    return (await this.getViewing(ws, viewingNo)) as ViewingRow;
  }

  private async daysOf(c: Pool | PoolClient, ws: string, agentCode: string): Promise<HomeAgentDay[]> {
    return (await c.query<DRow>(`SELECT ${DAY_COLS} FROM homes.agent_days WHERE workspace_id = $1 AND agent_code = $2 ORDER BY work_date`, [ws, agentCode])).rows.map(toDay);
  }

  /** Requested viewings that hold the agent's slots, and (when given) the viewer's own. */
  private async requestedFor(c: Pool | PoolClient, ws: string, agentCode: string, viewerEmail: string | null): Promise<ViewingRow[]> {
    const r = await c.query<VRow>(
      `SELECT ${VIEWING_COLS} FROM homes.viewings WHERE workspace_id = $1 AND status = 'requested' AND (agent_code = $2 OR lower(viewer_email) = $3)`,
      [ws, agentCode, viewerEmail ?? ""],
    );
    return r.rows.map(toViewing);
  }
}
