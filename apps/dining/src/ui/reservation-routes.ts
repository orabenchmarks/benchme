import { isDate } from "@benchme/scenarios";
import { DomainError, shell, type ShellCtx } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodIssue } from "zod";
import { changeSchema, filled, reservationSchema } from "../api/inputs.js";
import type { DiningRepo } from "../db/dining-repo.js";
import { flat, formOf, html, one } from "./kit.js";
import { reservationDetail, reservationsList } from "./reservation-pages.js";
import { dayParamsOf, type DayParams } from "./restaurant-page.js";

export type Page = { status: number; body: string };
/** What the reservation routes share with the browsing ones: the shell, and the restaurant page a refused reservation re-renders. A write asks no sign-in here: the site's rules ask it of every door. */
export type UiKit = {
  dining: DiningRepo;
  ctx: (req: FastifyRequest, flash?: string) => Promise<ShellCtx>;
  restaurantPage: (req: FastifyRequest, code: string, params: DayParams, flash?: string) => Promise<Page>;
};

const fields = (issues: ZodIssue[]) => issues.map((i) => i.path.join(".")).join(", ");

/** Reserve from a restaurant page; list, read, change and cancel reservations. A refused write re-renders its form page with the reason. */
export function registerReservationRoutes(app: FastifyInstance, k: UiKit): void {
  const reservationPage = async (req: FastifyRequest, no: string, flash?: string): Promise<Page> => {
    const c = await k.ctx(req, flash);
    const b = await k.dining.getReservation(req.workspaceId, no);
    if (!b) return { status: 404, body: shell(c, "Not found", "<h1>No such reservation</h1>") };
    const r = await k.dining.getRestaurant(req.workspaceId, b.restaurantCode);
    return { status: 200, body: shell(c, b.reservationNo, reservationDetail(req.prefix, b, r, !!c.user)) };
  };
  /** Runs a write; a domain refusal re-renders `onRefusal` with the reason and the refusal's status. */
  const write = async (reply: FastifyReply, fn: () => Promise<string>, onRefusal: (message: string) => Promise<Page>) => {
    try {
      return reply.redirect(await fn(), 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      const page = await onRefusal(err.message);
      return html(reply, page.body, err.status);
    }
  };

  app.post("/reservations", async (req, reply) => {
    const f = formOf(req);
    const code = one(f.restaurantCode) ?? "";
    const parsed = reservationSchema.safeParse(filled(flat(f)));
    if (!parsed.success) {
      const page = await k.restaurantPage(req, code, dayParamsOf(f), `Check the reservation: ${fields(parsed.error.issues)}`);
      return html(reply, page.body, page.status === 200 ? 400 : page.status);
    }
    return write(
      reply,
      async () => `${req.prefix}/reservations/${(await k.dining.createReservation(req.workspaceId, parsed.data)).reservationNo}`,
      (message) => k.restaurantPage(req, code, dayParamsOf(f), message),
    );
  });

  app.get("/reservations", async (req, reply) => {
    const f = flat(formOf(req));
    const date = f.date && isDate(f.date) ? f.date : undefined;
    const page = await k.dining.listReservations(req.workspaceId, {
      ...(f.guestEmail ? { guestEmail: f.guestEmail } : {}),
      ...(f.restaurant ? { restaurant: f.restaurant } : {}),
      ...(date ? { date } : {}),
      ...(f.cursor ? { cursor: f.cursor } : {}),
      limit: 25,
    });
    return html(reply, shell(await k.ctx(req), "Reservations", reservationsList(req.prefix, page.items, page.nextCursor, { guestEmail: f.guestEmail, restaurant: f.restaurant, date })));
  });

  app.get<{ Params: { no: string } }>("/reservations/:no", async (req, reply) => {
    const page = await reservationPage(req, req.params.no);
    return html(reply, page.body, page.status);
  });

  app.post<{ Params: { no: string } }>("/reservations/:no/change", async (req, reply) => {
    const f = flat(formOf(req));
    // An emptied special request clears it, so the note is kept even when blank.
    const parsed = changeSchema.safeParse({ ...filled(f), ...(f.note !== undefined ? { note: f.note } : {}) });
    if (!parsed.success) {
      const page = await reservationPage(req, req.params.no, `Check the change: ${fields(parsed.error.issues) || parsed.error.issues[0]?.message}`);
      return html(reply, page.body, page.status === 200 ? 400 : page.status);
    }
    return write(
      reply,
      async () => `${req.prefix}/reservations/${(await k.dining.changeReservation(req.workspaceId, req.params.no, parsed.data)).reservationNo}`,
      (message) => reservationPage(req, req.params.no, message),
    );
  });

  app.post<{ Params: { no: string } }>("/reservations/:no/cancel", async (req, reply) => {
    return write(
      reply,
      async () => `${req.prefix}/reservations/${(await k.dining.cancelReservation(req.workspaceId, req.params.no)).reservationNo}`,
      (message) => reservationPage(req, req.params.no, message),
    );
  });
}
