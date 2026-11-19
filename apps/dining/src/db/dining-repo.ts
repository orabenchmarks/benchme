import { withTx, type Pool, type PoolClient } from "@benchme/core";
import {
  DINING_AREAS,
  DINING_WEEKDAYS,
  diningAvailability,
  diningDepositCents,
  diningReservationProblem,
  diningSearch,
  diningWeekdayOf,
  isDate,
  type DiningArea,
  type DiningDayHours,
  type DiningOffer,
  type DiningQuery,
  type DiningRequest,
  type DiningReservation,
  type DiningReservationStatus,
  type DiningRestaurant,
  type DiningSeating,
  type DiningSlot,
  type DiningWeekday,
} from "@benchme/scenarios";
import { DomainError } from "@benchme/site-kit";

export type ReservationRow = DiningReservation & { cancelledAt: string | null };
export type RestaurantDetail = DiningRestaurant & { seating: DiningSeating[] };
export type RestaurantFilter = { city?: string; cuisine?: string; menus?: string[]; area?: DiningArea };
export type ReservationFilter = { guestEmail?: string; restaurant?: string; date?: string; status?: DiningReservationStatus; cursor?: string; limit: number };
export type NewReservation = DiningRequest & { restaurantCode: string; guestName: string; guestEmail: string; guestPhone: string; note: string };
export type ReservationChange = Partial<DiningRequest> & { note?: string };
export type DayAvailability = { restaurantCode: string; date: string; weekday: DiningWeekday | null; hours: DiningDayHours | null; partySize: number; slots: DiningSlot[] };

/**
 * Restaurants, seating and reservations. The reservation rules (window,
 * seating times, party, hours, area, table size, free tables, deposit) are
 * @benchme/scenarios' dining rules — the same functions the answer keys are
 * derived with — applied here inside the write's transaction.
 */
export interface DiningRepo {
  cities(ws: string): Promise<{ city: string; restaurants: number }[]>;
  listRestaurants(ws: string, f: RestaurantFilter): Promise<DiningRestaurant[]>;
  getRestaurant(ws: string, code: string): Promise<RestaurantDetail | null>;
  search(ws: string, q: DiningQuery): Promise<DiningOffer[]>;
  availability(ws: string, code: string, date: string, partySize: number): Promise<DayAvailability>;
  listReservations(ws: string, f: ReservationFilter): Promise<{ items: ReservationRow[]; nextCursor: string | null }>;
  getReservation(ws: string, no: string): Promise<ReservationRow | null>;
  createReservation(ws: string, input: NewReservation): Promise<ReservationRow>;
  /** Re-checks the whole reservation, as changed, against every rule; its own table is not counted against it. */
  changeReservation(ws: string, no: string, change: ReservationChange): Promise<ReservationRow>;
  /** confirmed → cancelled; a cancelled reservation stays cancelled. */
  cancelReservation(ws: string, no: string): Promise<ReservationRow>;
}

type RRow = {
  code: string; name: string; city: string; cuisine: string; price_level: number; description: string; menus: string[]; closed_day: DiningWeekday;
  hours: Partial<Record<DiningWeekday, DiningDayHours | null>>; deposit_per_guest_cents: number; private_room_fee_cents: number | null;
};
type SRow = { restaurant_code: string; area: DiningArea; seats: number; table_count: number };
type BRow = {
  reservation_no: string; restaurant_code: string; area: DiningArea; res_date: string; res_time: string; party_size: number; guest_name: string; guest_email: string;
  guest_phone: string; note: string; status: DiningReservationStatus; deposit_cents: number; created_at: Date; cancelled_at: Date | null;
};

const toRestaurant = (r: RRow): DiningRestaurant => ({
  code: r.code, name: r.name, city: r.city, cuisine: r.cuisine, priceLevel: r.price_level, description: r.description, menus: r.menus, closedDay: r.closed_day,
  // JSONB keeps its keys in its own order; the site lists the week Monday first.
  hours: Object.fromEntries(DINING_WEEKDAYS.map((d) => [d, r.hours[d] ?? null])) as Record<DiningWeekday, DiningDayHours | null>,
  depositPerGuestCents: r.deposit_per_guest_cents, privateRoomFeeCents: r.private_room_fee_cents,
});
const toSeating = (s: SRow): DiningSeating => ({ restaurantCode: s.restaurant_code, area: s.area, seats: s.seats, tables: s.table_count });
const toReservation = (b: BRow): ReservationRow => ({
  reservationNo: b.reservation_no, restaurantCode: b.restaurant_code, area: b.area, date: b.res_date, time: b.res_time, partySize: b.party_size, guestName: b.guest_name,
  guestEmail: b.guest_email, guestPhone: b.guest_phone, note: b.note, status: b.status, depositCents: b.deposit_cents, createdAt: b.created_at.toISOString(),
  cancelledAt: b.cancelled_at?.toISOString() ?? null,
});

// A DATE column read as text: node-postgres turns a DATE into a local-midnight Date, which shifts a day in any zone west of UTC.
const RES_COLS = "reservation_no, restaurant_code, area, to_char(res_date, 'YYYY-MM-DD') AS res_date, res_time, party_size, guest_name, guest_email, guest_phone, note, status, deposit_cents, created_at, cancelled_at";
/** Problems a guest can fix by asking for something else are 422; an area that is simply full is 409. */
const statusOf = (code: string) => (code === "FULL" ? 409 : 422);
const byArea = (x: DiningSeating, y: DiningSeating) => DINING_AREAS.indexOf(x.area) - DINING_AREAS.indexOf(y.area);
type Q = Pool | PoolClient;

export class PgDiningRepo implements DiningRepo {
  constructor(private readonly pool: Pool) {}

  async cities(ws: string) {
    const r = await this.pool.query<{ city: string; n: string }>("SELECT city, count(*) AS n FROM dining.restaurants WHERE workspace_id = $1 GROUP BY city ORDER BY city", [ws]);
    return r.rows.map((x) => ({ city: x.city, restaurants: Number(x.n) }));
  }

  async listRestaurants(ws: string, f: RestaurantFilter): Promise<DiningRestaurant[]> {
    const params: unknown[] = [ws];
    let where = "workspace_id = $1";
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where += ` AND ${sql.replace("?", `$${params.length}`)}`;
    };
    if (f.city) add("lower(city) = ?", f.city.trim().toLowerCase());
    if (f.cuisine) add("cuisine = ?", f.cuisine.trim().toLowerCase());
    if (f.menus?.length) add("menus @> ?::text[]", f.menus.map((m) => m.trim().toLowerCase()));
    if (f.area) add("EXISTS (SELECT 1 FROM dining.seating s WHERE s.workspace_id = restaurants.workspace_id AND s.restaurant_code = restaurants.code AND s.area = ?)", f.area);
    return (await this.pool.query<RRow>(`SELECT * FROM dining.restaurants WHERE ${where} ORDER BY code`, params)).rows.map(toRestaurant);
  }

  async getRestaurant(ws: string, code: string): Promise<RestaurantDetail | null> {
    const r = (await this.pool.query<RRow>("SELECT * FROM dining.restaurants WHERE workspace_id = $1 AND code = $2", [ws, code])).rows[0];
    return r ? { ...toRestaurant(r), seating: await this.seatingOf(this.pool, ws, [code]) } : null;
  }

  async search(ws: string, q: DiningQuery): Promise<DiningOffer[]> {
    const restaurants = await this.listRestaurants(ws, { city: q.city });
    const codes = restaurants.map((r) => r.code);
    if (codes.length === 0 || !isDate(q.date)) return [];
    return diningSearch({ restaurants, seating: await this.seatingOf(this.pool, ws, codes), reservations: await this.confirmedOn(this.pool, ws, codes, q.date) }, q);
  }

  async availability(ws: string, code: string, date: string, partySize: number): Promise<DayAvailability> {
    const r = await this.getRestaurant(ws, code);
    if (!r) throw new DomainError("UNKNOWN_RESTAURANT", `no restaurant ${code}`, 404);
    const weekday = isDate(date) ? diningWeekdayOf(date) : null;
    const slots = diningAvailability(r, { seating: r.seating, reservations: await this.confirmedOn(this.pool, ws, [code], date) }, date, partySize);
    return { restaurantCode: code, date, weekday, hours: weekday ? r.hours[weekday] : null, partySize, slots };
  }

  async listReservations(ws: string, f: ReservationFilter) {
    const params: unknown[] = [ws, f.limit + 1];
    let where = "workspace_id = $1";
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where += ` AND ${sql.replace("?", `$${params.length}`)}`;
    };
    if (f.guestEmail) add("lower(guest_email) = ?", f.guestEmail.trim().toLowerCase());
    if (f.restaurant) add("restaurant_code = ?", f.restaurant);
    if (f.date) add("res_date = ?::date", f.date);
    if (f.status) add("status = ?", f.status);
    if (f.cursor) add("reservation_no > ?", f.cursor);
    const r = await this.pool.query<BRow>(`SELECT ${RES_COLS} FROM dining.reservations WHERE ${where} ORDER BY reservation_no LIMIT $2`, params);
    const items = r.rows.slice(0, f.limit).map(toReservation);
    return { items, nextCursor: r.rows.length > f.limit ? (items[items.length - 1]?.reservationNo ?? null) : null };
  }

  async getReservation(ws: string, no: string, c: Q = this.pool): Promise<ReservationRow | null> {
    const r = await c.query<BRow>(`SELECT ${RES_COLS} FROM dining.reservations WHERE workspace_id = $1 AND reservation_no = $2`, [ws, no]);
    return r.rows[0] ? toReservation(r.rows[0]) : null;
  }

  async createReservation(ws: string, input: NewReservation): Promise<ReservationRow> {
    const guestName = input.guestName.trim();
    if (!guestName) throw new DomainError("NO_GUEST_NAME", "a reservation needs the guest's name", 422);
    const no = await withTx(this.pool, async (c) => {
      const r = await this.lockRestaurant(c, ws, input.restaurantCode);
      const req = { date: input.date, time: input.time, partySize: input.partySize, area: input.area };
      await this.check(c, ws, r, req);
      const n = await c.query<{ value: number }>(
        `INSERT INTO dining.counters (workspace_id, name, value) VALUES ($1, 'reservation', 1)
         ON CONFLICT (workspace_id, name) DO UPDATE SET value = dining.counters.value + 1 RETURNING value`,
        [ws],
      );
      const reservationNo = `RV-${50000 + (n.rows[0]?.value ?? 0)}`;
      await c.query(
        `INSERT INTO dining.reservations (workspace_id, reservation_no, restaurant_code, area, res_date, res_time, party_size, guest_name, guest_email, guest_phone, note, status, deposit_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'confirmed', $12)`,
        [ws, reservationNo, r.code, req.area, req.date, req.time, req.partySize, guestName, input.guestEmail.trim().toLowerCase(), input.guestPhone.trim(), input.note.trim(), diningDepositCents(r, req.area, req.partySize)],
      );
      return reservationNo;
    });
    // Read back after the commit: getReservation uses the pool, which cannot see the open transaction.
    return (await this.getReservation(ws, no)) as ReservationRow;
  }

  async changeReservation(ws: string, no: string, change: ReservationChange): Promise<ReservationRow> {
    await withTx(this.pool, async (c) => {
      const before = await this.getReservation(ws, no, c);
      if (!before) throw new DomainError("UNKNOWN_RESERVATION", `no reservation ${no}`, 404);
      // Restaurant first, then the row: the same order every write takes its locks in.
      const r = await this.lockRestaurant(c, ws, before.restaurantCode);
      const b = toReservation((await c.query<BRow>(`SELECT ${RES_COLS} FROM dining.reservations WHERE workspace_id = $1 AND reservation_no = $2 FOR UPDATE`, [ws, no])).rows[0] as BRow);
      if (b.status !== "confirmed") throw new DomainError("NOT_CONFIRMED", `reservation ${no} is cancelled; make a new one instead`, 409);
      const req = { date: change.date ?? b.date, time: change.time ?? b.time, partySize: change.partySize ?? b.partySize, area: change.area ?? b.area };
      await this.check(c, ws, r, req, no);
      await c.query(
        "UPDATE dining.reservations SET res_date = $3, res_time = $4, party_size = $5, area = $6, note = $7, deposit_cents = $8 WHERE workspace_id = $1 AND reservation_no = $2",
        [ws, no, req.date, req.time, req.partySize, req.area, (change.note ?? b.note).trim(), diningDepositCents(r, req.area, req.partySize)],
      );
    });
    return (await this.getReservation(ws, no)) as ReservationRow;
  }

  async cancelReservation(ws: string, no: string): Promise<ReservationRow> {
    const r = await this.pool.query("UPDATE dining.reservations SET status = 'cancelled', cancelled_at = now() WHERE workspace_id = $1 AND reservation_no = $2 AND status = 'confirmed'", [ws, no]);
    if (!r.rowCount) {
      if (!(await this.getReservation(ws, no))) throw new DomainError("UNKNOWN_RESERVATION", `no reservation ${no}`, 404);
      throw new DomainError("ALREADY_CANCELLED", `reservation ${no} is already cancelled`, 409);
    }
    return (await this.getReservation(ws, no)) as ReservationRow;
  }

  /** Locking the restaurant serialises its reservation writes, so two writers can never both take its last table. */
  private async lockRestaurant(c: PoolClient, ws: string, code: string): Promise<DiningRestaurant> {
    const r = (await c.query<RRow>("SELECT * FROM dining.restaurants WHERE workspace_id = $1 AND code = $2 FOR UPDATE", [ws, code])).rows[0];
    if (!r) throw new DomainError("UNKNOWN_RESTAURANT", `no restaurant ${code}`, 404);
    return toRestaurant(r);
  }

  private async check(c: PoolClient, ws: string, r: DiningRestaurant, req: DiningRequest, exceptNo?: string): Promise<void> {
    const seating = (await this.seatingOf(c, ws, [r.code])).find((s) => s.area === req.area);
    const held = isDate(req.date) ? await this.confirmedOn(c, ws, [r.code], req.date) : [];
    const problem = diningReservationProblem(r, seating, req, held, exceptNo);
    if (problem) throw new DomainError(problem.code, problem.message, statusOf(problem.code));
  }

  private async seatingOf(c: Q, ws: string, codes: string[]): Promise<DiningSeating[]> {
    const r = await c.query<SRow>("SELECT * FROM dining.seating WHERE workspace_id = $1 AND restaurant_code = ANY($2::text[])", [ws, codes]);
    return r.rows.map(toSeating).sort((x, y) => x.restaurantCode.localeCompare(y.restaurantCode) || byArea(x, y));
  }

  private async confirmedOn(c: Q, ws: string, codes: string[], date: string): Promise<DiningReservation[]> {
    if (!isDate(date)) return [];
    const r = await c.query<BRow>(`SELECT ${RES_COLS} FROM dining.reservations WHERE workspace_id = $1 AND restaurant_code = ANY($2::text[]) AND res_date = $3::date AND status = 'confirmed'`, [ws, codes, date]);
    return r.rows.map(toReservation);
  }
}
