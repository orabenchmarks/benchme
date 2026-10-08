import type { FastifyInstance } from "fastify";
import type { Status } from "../domain/types.js";
import type { RouteDeps } from "./deps.js";
import { esc, page } from "./html.js";

const SAID: Record<Status, string> = {
  created: "This request has not been sent for approval yet.",
  pending_approval: "Waiting for approval. Approval comes from the wallet's approval policy within a few seconds.",
  approved: "Approved. The agent can now retrieve the card for this purchase.",
  requires_action: "This request needs an extra verification step before it can be approved.",
  denied: "Declined. No card was issued for this request.",
  expired: "This request expired.",
  canceled: "This request was canceled.",
};

/**
 * The two pages link-cli prints for a person: the device-login page (verification_uri) and a spend request's
 * approval page (approval_url). There is nothing to do on either — the wallet's policy approves — so they say
 * where things stand. A request's page shows its merchant, amount and status, never the card.
 */
export function registerPages(app: FastifyInstance, d: RouteDeps): void {
  app.get("/device", async (_req, reply) =>
    reply.type("text/html; charset=utf-8").send(page("Connect a device", "<h1>Device connected</h1><p>This wallet approves device connections by policy: the command-line tool that showed you this address is connected — go back to it.</p>")),
  );

  app.get<{ Params: { id: string } }>("/approvals/:id", async (req, reply) => {
    const r = /^lsrq_[0-9a-f]{24}$/.test(req.params.id) ? await d.requests.get(req.params.id) : null;
    if (!r) return reply.code(404).type("text/html; charset=utf-8").send(page("Not found", "<h1>No such spend request</h1>"));
    const refreshed = await d.spendRequests.refresh(r);
    const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: refreshed.currency.toUpperCase() }).format(refreshed.amount / 100);
    return reply.type("text/html; charset=utf-8").send(
      page(
        "Spend request",
        `<h1>Spend request</h1><dl><dt>Merchant</dt><dd>${esc(refreshed.merchantName ?? "")}</dd><dt>Amount</dt><dd>${esc(amount)}</dd><dt>Status</dt><dd>${esc(refreshed.status)}</dd></dl><p>${esc(SAID[refreshed.status])}</p>`,
      ),
    );
  });
}
