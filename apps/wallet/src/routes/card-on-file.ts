import type { FastifyInstance } from "fastify";
import { expiryText, groupedNumber, prefersJson, savedCardView } from "../domain/saved-card.js";
import type { Holder } from "../domain/view.js";
import type { DoorAnswer } from "../service/card-on-file.js";
import { signedWorkspace, type RouteDeps } from "./deps.js";
import { esc, page } from "./html.js";

/**
 * Where the gateway's `wallet` WORKSPACE app lands in this service: APP_TARGETS names it
 * `http://<wallet>/workspace`, so <public>/w/<workspaceId>/wallet/card arrives here as /workspace/card with the
 * workspace signed. It is UNLISTED (UNLISTED_APPS): never in a workspace's urls, the portal or robots.txt. The root
 * service (SERVICE_TARGETS, /wallet/*) drops any workspace header, so /wallet/workspace/card is refused.
 */
export const WORKSPACE_PREFIX = "/workspace";

/** Why no card is shown, as the door says it to the shopper. */
const NO_CARD: Record<Exclude<DoorAnswer["outcome"], "shown">, string> = {
  no_store: "No store is open in this session yet. Open the store you are buying from first, then come back to this page: your saved card appears here once you have.",
  ambiguous: "More than one store is open in this session, so this wallet cannot tell which purchase the saved card is for.",
  unavailable: "Your saved card cannot be shown just now. Try this page again in a moment.",
};

function json(a: DoorAnswer, holder: Holder): Record<string, unknown> {
  return a.card ? { object: "saved_card", card: savedCardView(a.card, holder) } : { object: "saved_card", card: null, reason: a.outcome, message: NO_CARD[a.outcome] };
}

function html(a: DoorAnswer, holder: Holder): string {
  if (!a.card) return page("Saved card", `<h1>Saved card</h1><p>${esc(NO_CARD[a.outcome])}</p>`);
  const c = a.card;
  const address = `${holder.line1}, ${holder.city}, ${holder.state} ${holder.postalCode}, ${holder.country}`;
  const row = (label: string, value: string) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`;
  return page(
    "Saved card",
    `<h1>Saved card</h1><p>The card saved in your wallet. Pay with it at checkout.</p><dl>${[
      row("Name on card", holder.name),
      row("Card number", groupedNumber(c.number)),
      row("Expiry (MM/YY)", expiryText(c)),
      row("CVC", c.cvc),
      row("Billing ZIP", holder.postalCode),
      row("Billing address", address),
    ].join("")}</dl>`,
  );
}

/**
 * GET /workspace/card — the card-on-file door: the buyer's saved card for the workspace the gateway signed, as a
 * page (HTML, what a browser asks for) or as JSON (`Accept: application/json`). Every read is recorded, including
 * one before the workspace has opened a store (no card yet). Not served without the gateway's secret.
 */
export function registerCardOnFile(app: FastifyInstance, d: RouteDeps): void {
  const secret = d.gatewaySecret;
  if (!secret) return;
  app.get(`${WORKSPACE_PREFIX}/card`, async (req, reply) => {
    const workspace = signedWorkspace(req, secret);
    if (!workspace) return reply.code(401).send({ error: "NO_WORKSPACE", message: "requests must come through the benchme gateway" });
    const format = prefersJson(req.headers.accept) ? "json" : "html";
    const ua = req.headers["user-agent"];
    const a = await d.cardOnFile.read(workspace, { format, userAgent: (Array.isArray(ua) ? ua[0] : ua) ?? null });
    reply.code(a.outcome === "unavailable" ? 503 : 200).header("cache-control", "no-store").header("vary", "accept");
    return format === "json" ? reply.send(json(a, d.account.holder)) : reply.type("text/html; charset=utf-8").send(html(a, d.account.holder));
  });
}
