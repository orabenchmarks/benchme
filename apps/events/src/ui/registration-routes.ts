import { DomainError } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { registrationDetail, registrationsList } from "./pages/registrations.js";
import { flat, query, type UiKit } from "./shell.js";

/** The registrations list, one registration's page, and cancelling it. */
export function registerRegistrationUi(app: FastifyInstance, k: UiKit): void {
  const { d } = k;
  type P = { Params: { no: string } };
  const regPage = async (req: FastifyRequest, reply: FastifyReply, no: string, opts: { code?: number; flash?: string } = {}) => {
    const r = await d.registrations.getRegistration(req.workspaceId, no);
    if (!r) return k.page(req, reply, "Not found", () => "<h1>No such registration</h1>", { code: 404 });
    return k.page(req, reply, r.regNo, (c) => registrationDetail(req.prefix, r, !!c.user), opts);
  };

  app.get("/registrations", async (req, reply) => {
    const f = flat(query(req));
    const filter = Object.fromEntries(Object.entries({ email: f.email, event: f.event, cursor: f.cursor }).filter(([, v]) => v));
    const list = await d.registrations.listRegistrations(req.workspaceId, { ...filter, limit: 50 });
    return k.page(req, reply, "Registrations", () => registrationsList(req.prefix, list.items, list.nextCursor, { email: f.email, event: f.event }));
  });

  app.get<P>("/registrations/:no", async (req, reply) => regPage(req, reply, req.params.no));

  app.post<P>("/registrations/:no/cancel", async (req, reply) => {
    try {
      await d.registrations.cancelRegistration(req.workspaceId, req.params.no);
      return reply.redirect(`${req.prefix}/registrations/${req.params.no}`, 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      return regPage(req, reply, req.params.no, { code: err.status, flash: err.message });
    }
  });
}
