import { isDate } from "@benchme/scenarios";
import { DomainError, shell } from "@benchme/site-kit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { bookingSchema, dropEmpty } from "../api/inputs.js";
import * as bookingPages from "./booking-pages.js";
import type { BookingForm } from "./flight-pages.js";
import type { Page, UiDeps, UiKit } from "./routes.js";

type Q = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const text = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join("\n") : v);

/** Booking from a flight page, the bookings list, a booking's page, and cancelling from it. */
export function registerBookingUi(app: FastifyInstance, d: UiDeps, kit: UiKit): void {
  app.post("/bookings", async (req, reply) => {
    if (!(await kit.requireUser(req, reply))) return;
    const f = (req.body ?? {}) as Q;
    const flightNo = one(f.flightNo) ?? "";
    const form: BookingForm = { date: one(f.date), cabin: one(f.cabin), passengers: text(f.passengers), bags: one(f.bags), contactEmail: one(f.contactEmail) };
    const parsed = bookingSchema.safeParse(dropEmpty(f));
    if (!parsed.success) {
      const page = await kit.flightPage(req, flightNo, form, `Check the booking: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
      return kit.html(reply, { ...page, status: 400 });
    }
    try {
      const b = await d.flights.createBooking(req.workspaceId, parsed.data);
      return reply.redirect(`${req.prefix}/bookings/${b.bookingNo}`, 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      const page = await kit.flightPage(req, flightNo, form, err.message);
      return kit.html(reply, { ...page, status: err.status });
    }
  });

  app.get("/bookings", async (req, reply) => {
    const f = (req.query ?? {}) as Q;
    const filter = { contactEmail: one(f.contactEmail) || undefined, flightNo: one(f.flightNo) || undefined, date: one(f.date) || undefined };
    const cursor = one(f.cursor);
    const date = filter.date && isDate(filter.date) ? filter.date : undefined;
    const list = await d.flights.listBookings(req.workspaceId, { ...(filter.contactEmail ? { contactEmail: filter.contactEmail } : {}), ...(filter.flightNo ? { flightNo: filter.flightNo } : {}), ...(date ? { date } : {}), ...(cursor ? { cursor } : {}), limit: 25 });
    return kit.html(reply, { status: 200, body: shell(await kit.ctx(req), "Bookings", bookingPages.bookingsList(req.prefix, list.items, list.nextCursor, filter, await kit.airports(req))) });
  });

  const bookingPage = async (req: FastifyRequest, no: string, flash?: string): Promise<Page> => {
    const c = await kit.ctx(req, flash);
    const b = await d.flights.getBooking(req.workspaceId, no);
    if (!b) return { status: 404, body: shell(c, "Not found", "<h1>No such booking</h1>") };
    return { status: 200, body: shell(c, b.bookingNo, bookingPages.bookingDetail(req.prefix, b, await kit.airports(req), !!c.user)) };
  };

  app.get<{ Params: { no: string } }>("/bookings/:no", async (req, reply) => kit.html(reply, await bookingPage(req, req.params.no)));

  app.post<{ Params: { no: string } }>("/bookings/:no/cancel", async (req, reply) => {
    if (!(await kit.requireUser(req, reply))) return;
    try {
      await d.flights.cancelBooking(req.workspaceId, req.params.no);
      return reply.redirect(`${req.prefix}/bookings/${req.params.no}`, 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      const page = await bookingPage(req, req.params.no, err.message);
      return kit.html(reply, { ...page, status: err.status });
    }
  });
}
