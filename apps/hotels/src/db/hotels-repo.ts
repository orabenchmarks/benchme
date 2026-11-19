import { withTx, type Pool, type PoolClient } from "@benchme/core";
import { MAX_NIGHTS, checkOutOf, roomsLeft, searchStays, stayProblem, stayTotalCents, type Booking, type BookingStatus, type Hotel, type RoomType, type Stay, type StayOffer, type StayQuery } from "@benchme/scenarios";
import { DomainError } from "@benchme/site-kit";

export type BookingRow = Booking & { checkOut: string; cancelledAt: string | null };
export type HotelDetail = Hotel & { rooms: RoomType[] };
export type HotelFilter = { city?: string; amenities?: string[]; pets?: boolean };
export type BookingFilter = { guestEmail?: string; hotel?: string; status?: BookingStatus; cursor?: string; limit: number };
export type NewBooking = Stay & { roomCode: string; hotelCode?: string; guestName: string; guestEmail: string };
export type Availability = { roomCode: string; checkIn: string; nights: number; roomsLeft: number };

/**
 * Hotels, room types and bookings. The booking rules (window, capacity, pets,
 * late checkout, availability, totals) are @benchme/scenarios' stays rules —
 * the same functions the answer keys are derived with — applied here inside
 * the write's transaction.
 */
export interface HotelsRepo {
  cities(ws: string): Promise<{ city: string; hotels: number }[]>;
  listHotels(ws: string, f: HotelFilter): Promise<Hotel[]>;
  getHotel(ws: string, code: string): Promise<HotelDetail | null>;
  search(ws: string, q: StayQuery): Promise<StayOffer[]>;
  availability(ws: string, roomCode: string, checkIn: string, nights: number): Promise<Availability>;
  listBookings(ws: string, f: BookingFilter): Promise<{ items: BookingRow[]; nextCursor: string | null }>;
  getBooking(ws: string, bookingNo: string): Promise<BookingRow | null>;
  createBooking(ws: string, input: NewBooking): Promise<BookingRow>;
  /** confirmed → cancelled; a cancelled booking stays cancelled. */
  cancelBooking(ws: string, bookingNo: string): Promise<BookingRow>;
}

type HRow = {
  code: string; name: string; city: string; rating: string; description: string; amenities: string[]; pets_allowed: boolean;
  pet_fee_cents: number | null; late_checkout_until: string | null; late_checkout_fee_cents: number | null;
};
type RRow = { code: string; hotel_code: string; name: string; max_adults: number; max_kids: number; nightly_cents: number; rooms: number };
type BRow = {
  booking_no: string; hotel_code: string; room_code: string; guest_name: string; guest_email: string; check_in: string; nights: number;
  adults: number; kids: number; pets: number; late_checkout: boolean; status: BookingStatus; total_cents: number; created_at: Date; cancelled_at: Date | null;
};

const toHotel = (r: HRow): Hotel => ({
  code: r.code, name: r.name, city: r.city, rating: Number(r.rating), description: r.description, amenities: r.amenities, petsAllowed: r.pets_allowed,
  petFeeCents: r.pet_fee_cents, lateCheckoutUntil: r.late_checkout_until, lateCheckoutFeeCents: r.late_checkout_fee_cents,
});
const toRoom = (r: RRow): RoomType => ({ hotelCode: r.hotel_code, code: r.code, name: r.name, maxAdults: r.max_adults, maxKids: r.max_kids, nightlyCents: r.nightly_cents, rooms: r.rooms });
const toBooking = (r: BRow): BookingRow => ({
  bookingNo: r.booking_no, hotelCode: r.hotel_code, roomCode: r.room_code, guestName: r.guest_name, guestEmail: r.guest_email, checkIn: r.check_in,
  checkOut: checkOutOf(r.check_in, r.nights), nights: r.nights, adults: r.adults, kids: r.kids, pets: r.pets, lateCheckout: r.late_checkout, status: r.status,
  totalCents: r.total_cents, createdAt: r.created_at.toISOString(), cancelledAt: r.cancelled_at?.toISOString() ?? null,
});

// A DATE column read as text: node-postgres turns a DATE into a local-midnight Date, which shifts a day in any zone west of UTC.
const BOOKING_COLS = "booking_no, hotel_code, room_code, guest_name, guest_email, to_char(check_in, 'YYYY-MM-DD') AS check_in, nights, adults, kids, pets, late_checkout, status, total_cents, created_at, cancelled_at";
/** Problems a guest can fix by asking for something else are 422; a room that is simply taken is 409. */
const statusOf = (code: string) => (code === "SOLD_OUT" ? 409 : 422);

export class PgHotelsRepo implements HotelsRepo {
  constructor(private readonly pool: Pool) {}

  async cities(ws: string) {
    const r = await this.pool.query<{ city: string; hotels: string }>("SELECT city, count(*) AS hotels FROM hotels.hotels WHERE workspace_id = $1 GROUP BY city ORDER BY city", [ws]);
    return r.rows.map((x) => ({ city: x.city, hotels: Number(x.hotels) }));
  }

  async listHotels(ws: string, f: HotelFilter): Promise<Hotel[]> {
    const params: unknown[] = [ws];
    let where = "workspace_id = $1";
    if (f.city) {
      params.push(f.city.trim().toLowerCase());
      where += ` AND lower(city) = $${params.length}`;
    }
    if (f.amenities?.length) {
      params.push(f.amenities.map((a) => a.trim().toLowerCase()));
      where += ` AND amenities @> $${params.length}::text[]`;
    }
    if (f.pets) where += " AND pets_allowed";
    return (await this.pool.query<HRow>(`SELECT * FROM hotels.hotels WHERE ${where} ORDER BY code`, params)).rows.map(toHotel);
  }

  async getHotel(ws: string, code: string): Promise<HotelDetail | null> {
    const h = (await this.pool.query<HRow>("SELECT * FROM hotels.hotels WHERE workspace_id = $1 AND code = $2", [ws, code])).rows[0];
    if (!h) return null;
    const rooms = await this.pool.query<RRow>("SELECT * FROM hotels.room_types WHERE workspace_id = $1 AND hotel_code = $2 ORDER BY nightly_cents, code", [ws, code]);
    return { ...toHotel(h), rooms: rooms.rows.map(toRoom) };
  }

  async search(ws: string, q: StayQuery): Promise<StayOffer[]> {
    const hotels = await this.listHotels(ws, { city: q.city });
    if (hotels.length === 0) return [];
    const codes = hotels.map((h) => h.code);
    const rooms = (await this.pool.query<RRow>("SELECT * FROM hotels.room_types WHERE workspace_id = $1 AND hotel_code = ANY($2::text[])", [ws, codes])).rows.map(toRoom);
    const bookings = await this.confirmedFor(this.pool, ws, rooms.map((r) => r.code));
    return searchStays({ hotels, rooms, bookings }, q);
  }

  async availability(ws: string, roomCode: string, checkIn: string, nights: number): Promise<Availability> {
    // The count walks the stay night by night, so its length is held to the rules' cap here, whatever the door let through.
    if (!Number.isInteger(nights) || nights < 1 || nights > MAX_NIGHTS) throw new DomainError("BAD_NIGHTS", `a stay is 1 to ${MAX_NIGHTS} nights`, 422);
    const room = (await this.pool.query<RRow>("SELECT * FROM hotels.room_types WHERE workspace_id = $1 AND code = $2", [ws, roomCode])).rows[0];
    if (!room) throw new DomainError("UNKNOWN_ROOM", `no room type ${roomCode}`, 404);
    return { roomCode, checkIn, nights, roomsLeft: roomsLeft(toRoom(room), await this.confirmedFor(this.pool, ws, [roomCode]), checkIn, nights) };
  }

  async listBookings(ws: string, f: BookingFilter) {
    const params: unknown[] = [ws, f.limit + 1];
    let where = "workspace_id = $1";
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where += ` AND ${sql.replace("?", `$${params.length}`)}`;
    };
    if (f.guestEmail) add("lower(guest_email) = ?", f.guestEmail.trim().toLowerCase());
    if (f.hotel) add("hotel_code = ?", f.hotel);
    if (f.status) add("status = ?", f.status);
    if (f.cursor) add("booking_no > ?", f.cursor);
    const r = await this.pool.query<BRow>(`SELECT ${BOOKING_COLS} FROM hotels.bookings WHERE ${where} ORDER BY booking_no LIMIT $2`, params);
    const items = r.rows.slice(0, f.limit).map(toBooking);
    return { items, nextCursor: r.rows.length > f.limit ? (items[items.length - 1]?.bookingNo ?? null) : null };
  }

  async getBooking(ws: string, bookingNo: string): Promise<BookingRow | null> {
    const r = await this.pool.query<BRow>(`SELECT ${BOOKING_COLS} FROM hotels.bookings WHERE workspace_id = $1 AND booking_no = $2`, [ws, bookingNo]);
    return r.rows[0] ? toBooking(r.rows[0]) : null;
  }

  async createBooking(ws: string, input: NewBooking): Promise<BookingRow> {
    const guestName = input.guestName.trim();
    const guestEmail = input.guestEmail.trim().toLowerCase();
    if (!guestName) throw new DomainError("NO_GUEST_NAME", "a booking needs the guest's name", 422);
    const bookingNo = await withTx(this.pool, async (c) => {
      // Locking the room type serialises bookings of it, so two writers can never both take its last room.
      const room = (await c.query<RRow>("SELECT * FROM hotels.room_types WHERE workspace_id = $1 AND code = $2 FOR UPDATE", [ws, input.roomCode])).rows[0];
      if (!room) throw new DomainError("UNKNOWN_ROOM", `no room type ${input.roomCode}`, 404);
      if (input.hotelCode && input.hotelCode !== room.hotel_code) throw new DomainError("ROOM_NOT_IN_HOTEL", `room type ${input.roomCode} belongs to ${room.hotel_code}, not ${input.hotelCode}`, 422);
      const hotel = toHotel((await c.query<HRow>("SELECT * FROM hotels.hotels WHERE workspace_id = $1 AND code = $2", [ws, room.hotel_code])).rows[0] as HRow);
      const roomType = toRoom(room);
      const problem = stayProblem(hotel, roomType, input, await this.confirmedFor(c, ws, [room.code]));
      if (problem) throw new DomainError(problem.code, problem.message, statusOf(problem.code));
      const n = await c.query<{ value: number }>(
        `INSERT INTO hotels.counters (workspace_id, name, value) VALUES ($1, 'booking', 1)
         ON CONFLICT (workspace_id, name) DO UPDATE SET value = hotels.counters.value + 1 RETURNING value`,
        [ws],
      );
      const no = `BK-${50000 + (n.rows[0]?.value ?? 0)}`;
      await c.query(
        `INSERT INTO hotels.bookings (workspace_id, booking_no, hotel_code, room_code, guest_name, guest_email, check_in, nights, adults, kids, pets, late_checkout, status, total_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'confirmed', $13)`,
        [ws, no, hotel.code, room.code, guestName, guestEmail, input.checkIn, input.nights, input.adults, input.kids, input.pets, input.lateCheckout, stayTotalCents(hotel, roomType, input)],
      );
      return no;
    });
    // Read back after the commit: getBooking uses the pool, which cannot see the open transaction.
    return (await this.getBooking(ws, bookingNo)) as BookingRow;
  }

  async cancelBooking(ws: string, bookingNo: string): Promise<BookingRow> {
    const r = await this.pool.query("UPDATE hotels.bookings SET status = 'cancelled', cancelled_at = now() WHERE workspace_id = $1 AND booking_no = $2 AND status = 'confirmed'", [ws, bookingNo]);
    if (!r.rowCount) {
      if (!(await this.getBooking(ws, bookingNo))) throw new DomainError("UNKNOWN_BOOKING", `no booking ${bookingNo}`, 404);
      throw new DomainError("ALREADY_CANCELLED", `booking ${bookingNo} is already cancelled`, 409);
    }
    return (await this.getBooking(ws, bookingNo)) as BookingRow;
  }

  private async confirmedFor(c: Pool | PoolClient, ws: string, roomCodes: string[]): Promise<Booking[]> {
    if (roomCodes.length === 0) return [];
    const r = await c.query<BRow>(`SELECT ${BOOKING_COLS} FROM hotels.bookings WHERE workspace_id = $1 AND room_code = ANY($2::text[]) AND status = 'confirmed'`, [ws, roomCodes]);
    return r.rows.map(toBooking);
  }
}
