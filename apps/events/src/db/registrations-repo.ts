import { withTx, type Pool } from "@benchme/core";
import { eventRegisterProblem, type EventRegistrant, type EventRegistrationStatus } from "@benchme/scenarios";
import { DomainError } from "@benchme/site-kit";
import { registrationSlice } from "./load.js";
import { REGISTRATION_SELECT, statusOf, toRegistration, type GRow, type RegistrationView } from "./rows.js";

export type RegistrationFilter = { email?: string; event?: string; status?: EventRegistrationStatus; cursor?: string; limit: number };

/** Registrations for open events. A cancelled registration holds no place and can be followed by a new one. */
export interface RegistrationsRepo {
  listRegistrations(ws: string, f: RegistrationFilter): Promise<{ items: RegistrationView[]; nextCursor: string | null }>;
  getRegistration(ws: string, regNo: string): Promise<RegistrationView | null>;
  register(ws: string, eventCode: string, who: EventRegistrant): Promise<RegistrationView>;
  /** registered → cancelled; a cancelled registration stays cancelled. */
  cancelRegistration(ws: string, regNo: string): Promise<RegistrationView>;
  /** The person's active registration for the event, cancelled. */
  cancelRegistrationFor(ws: string, eventCode: string, email: string): Promise<RegistrationView>;
}

export class PgRegistrationsRepo implements RegistrationsRepo {
  constructor(private readonly pool: Pool) {}

  async listRegistrations(ws: string, f: RegistrationFilter) {
    const params: unknown[] = [ws, f.limit + 1];
    let where = "r.workspace_id = $1";
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where += ` AND ${sql.replace("?", `$${params.length}`)}`;
    };
    if (f.email) add("r.email = ?", f.email.trim().toLowerCase());
    if (f.event) add("r.event_code = ?", f.event);
    if (f.status) add("r.status = ?", f.status);
    if (f.cursor) add("r.reg_no > ?", f.cursor);
    const r = await this.pool.query<GRow>(`${REGISTRATION_SELECT} WHERE ${where} ORDER BY r.reg_no LIMIT $2`, params);
    const items = r.rows.slice(0, f.limit).map(toRegistration);
    return { items, nextCursor: r.rows.length > f.limit ? (items[items.length - 1]?.regNo ?? null) : null };
  }

  async getRegistration(ws: string, regNo: string): Promise<RegistrationView | null> {
    const r = await this.pool.query<GRow>(`${REGISTRATION_SELECT} WHERE r.workspace_id = $1 AND r.reg_no = $2`, [ws, regNo]);
    return r.rows[0] ? toRegistration(r.rows[0]) : null;
  }

  async register(ws: string, eventCode: string, who: EventRegistrant): Promise<RegistrationView> {
    const name = who.name.trim();
    const email = who.email.trim().toLowerCase();
    const regNo = await withTx(this.pool, async (c) => {
      // The event row serialises its places; the advisory lock serialises one person's registrations, so two at once cannot overlap.
      const locked = await c.query("SELECT 1 FROM events.events WHERE workspace_id = $1 AND code = $2 FOR UPDATE", [ws, eventCode]);
      if (!locked.rowCount) throw new DomainError("UNKNOWN_EVENT", `no event ${eventCode}`, 404);
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`events:${ws}:${email}`]);
      const slice = await registrationSlice(c, ws, eventCode, email);
      const event = slice.events.find((e) => e.code === eventCode);
      if (!event) throw new DomainError("UNKNOWN_EVENT", `no event ${eventCode}`, 404);
      const problem = eventRegisterProblem({ offices: [], rooms: [], people: [], ...slice }, event, { name, email });
      if (problem) throw new DomainError(problem.code, problem.message, statusOf(problem.code));
      const n = await c.query<{ value: number }>(
        `INSERT INTO events.counters (workspace_id, name, value) VALUES ($1, 'registration', 1)
         ON CONFLICT (workspace_id, name) DO UPDATE SET value = events.counters.value + 1 RETURNING value`,
        [ws],
      );
      const no = `RG-${60000 + (n.rows[0]?.value ?? 0)}`;
      await c.query("INSERT INTO events.registrations (workspace_id, reg_no, event_code, name, email, status) VALUES ($1, $2, $3, $4, $5, 'registered')", [ws, no, eventCode, name, email]);
      return no;
    });
    return (await this.getRegistration(ws, regNo)) as RegistrationView;
  }

  async cancelRegistration(ws: string, regNo: string): Promise<RegistrationView> {
    const r = await this.pool.query("UPDATE events.registrations SET status = 'cancelled', cancelled_at = now() WHERE workspace_id = $1 AND reg_no = $2 AND status = 'registered'", [ws, regNo]);
    if (!r.rowCount) {
      if (!(await this.getRegistration(ws, regNo))) throw new DomainError("UNKNOWN_REGISTRATION", `no registration ${regNo}`, 404);
      throw new DomainError("ALREADY_CANCELLED", `registration ${regNo} is already cancelled`, 409);
    }
    return (await this.getRegistration(ws, regNo)) as RegistrationView;
  }

  async cancelRegistrationFor(ws: string, eventCode: string, email: string): Promise<RegistrationView> {
    const active = await this.listRegistrations(ws, { event: eventCode, email, status: "registered", limit: 1 });
    const reg = active.items[0];
    if (!reg) throw new DomainError("NOT_REGISTERED", `${email.trim().toLowerCase()} has no active registration for ${eventCode}`, 404);
    return this.cancelRegistration(ws, reg.regNo);
  }
}
