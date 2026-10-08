import type { FastifyInstance } from "fastify";
import { notFound, unauthenticated } from "../domain/link-errors.js";
import { parseCreate, parseUpdate } from "../domain/spend-request-input.js";
import type { Session, SpendRequestRow } from "../domain/types.js";
import { spendRequestView } from "../domain/view.js";
import { approvalPolicyView, paymentMethodIdOf, paymentMethodView, userInfoView } from "../service/account.js";
import { bearer, publicBase, type RouteDeps } from "./deps.js";

/**
 * LINK_API_BASE_URL = <wallet>/api: what link-cli 0.26.0 calls with the session's bearer token — the account
 * (payment-details, userinfo, approval-policy, shipping_addresses), reports (agent_observations) and the spend
 * requests. Anything else Link offers (balances, sources, transactions, insights, …) answers as an account
 * without that feature would: Link's 404.
 */
export function registerApiRoutes(app: FastifyInstance, d: RouteDeps): void {
  app.register(
    async (api) => {
      api.addHook("onRequest", async (req) => {
        const token = bearer(req);
        const session = token ? await d.login.authenticate(token) : null;
        if (!session) throw unauthenticated();
        req.walletSession = session;
      });
      const me = (req: { walletSession: Session | null }) => req.walletSession as Session;
      const view = (req: Parameters<typeof publicBase>[0], r: SpendRequestRow, includeCard = false) =>
        spendRequestView(r, { includeCard, approvalUrl: `${publicBase(req, d.publicUrl)}/approvals/${r.id}`, holder: d.account.holder });

      api.get("/payment-details", async (req) => ({ payment_details: [paymentMethodView(me(req), d.account)] }));
      api.get<{ Params: { id: string } }>("/payment-details/:id", async (req) => {
        if (req.params.id !== paymentMethodIdOf(me(req))) throw notFound("payment method", req.params.id);
        return paymentMethodView(me(req), d.account);
      });
      api.post<{ Params: { id: string }; Body: { nickname?: string } }>("/payment-details/:id", async (req) => {
        if (req.params.id !== paymentMethodIdOf(me(req))) throw notFound("payment method", req.params.id);
        const nickname = typeof req.body?.nickname === "string" ? req.body.nickname.trim() : "";
        return { ...paymentMethodView(me(req), d.account), nickname: nickname || null };
      });
      api.get("/userinfo", async (req) => {
        const approved = (await d.spendRequests.list(me(req), true)).filter((r) => r.approvedAt && r.canceledAt === null);
        const since = (ms: number) => approved.filter((r) => (r.approvedAt as Date).getTime() >= d.now().getTime() - ms).reduce((a, r) => a + r.amount, 0);
        return userInfoView(me(req), d.account, { daily: since(86_400_000), thirtyDay: since(30 * 86_400_000) });
      });
      api.get("/approval-policy", async () => approvalPolicyView());
      api.get("/shipping_addresses", async () => ({ shipping_addresses: [] }));
      api.post<{ Body: Record<string, unknown> }>("/agent_observations", async (req) => {
        const b = req.body ?? {};
        await d.events.record({ session: me(req).id, request: typeof b.spend_request_id === "string" ? b.spend_request_id : null, kind: "observation", data: b });
        return { object: "agent_observation", created_at: d.now().toISOString(), domain: String(b.domain ?? ""), outcome: String(b.outcome ?? ""), spend_request_id: String(b.spend_request_id ?? ""), status: "received" };
      });

      api.get<{ Querystring: { include_history?: string } }>("/spend_requests", async (req) => ({
        data: (await d.spendRequests.list(me(req), req.query.include_history === "true")).map((r) => view(req, r)),
      }));
      for (const [path, decideNow] of [["/spend_requests", false], ["/spend_requests/create_delegated", true]] as const) {
        api.post(path, async (req) => view(req, await d.spendRequests.create(me(req), parseCreate(req.body), { decideNow })));
      }
      api.get<{ Params: { id: string }; Querystring: { include?: string } }>("/spend_requests/:id", async (req) => {
        const include = (req.query.include ?? "").split(",").map((s) => s.trim());
        return view(req, await d.spendRequests.retrieve(me(req), req.params.id), include.includes("card"));
      });
      for (const [path, decideNow] of [["/spend_requests/:id", false], ["/spend_requests/:id/update_delegated", true]] as const) {
        api.post<{ Params: { id: string } }>(path, async (req) => view(req, await d.spendRequests.update(me(req), req.params.id, parseUpdate(req.body), { decideNow })));
      }
      api.post<{ Params: { id: string } }>("/spend_requests/:id/cancel", async (req) => view(req, await d.spendRequests.cancel(me(req), req.params.id)));
      api.post<{ Params: { id: string } }>("/spend_requests/:id/request_approval", async (req) => {
        const r = await d.spendRequests.requestApproval(me(req), req.params.id);
        return { id: r.id, approval_link: `${publicBase(req, d.publicUrl)}/approvals/${r.id}` };
      });
    },
    { prefix: "/api" },
  );
}
