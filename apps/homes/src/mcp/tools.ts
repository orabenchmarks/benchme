import { HOME_FEATURES, HOME_LISTING_STATUSES, HOME_TYPES } from "@benchme/scenarios";
import { DomainError, ToolRegistry } from "@benchme/site-kit";
import { z } from "zod";
import { dateOf, moment, timeOf, toQuery } from "../api/inputs.js";
import type { HomesRepo } from "../db/homes-repo.js";

export type ToolContext = { workspaceId: string; homes: HomesRepo };

const notFound = (what: string) => {
  throw new DomainError("NOT_FOUND", `${what} not found`, 404);
};
// A fresh instance per field: one shared by minBeds and minBaths becomes a "$ref" in the tool's JSON Schema, which some agent clients cannot follow.
const count = () => z.number().int().min(0).max(20).optional();

/** The home site's MCP surface (and, through the bridge, its WebMCP tools): search listings, read one, find a slot, request and cancel a viewing. */
export function homeTools(): ToolRegistry<ToolContext> {
  return new ToolRegistry<ToolContext>()
    .register({
      name: "list_cities",
      description: "The cities the site has listings in, with how many listings each and how many of them are active.",
      input: {},
      handler: (_a, c) => c.homes.cities(c.workspaceId),
    })
    .register({
      name: "search_listings",
      description:
        "Listings matching every filter given, cheapest first. Prices are dollars (asking price); the results carry cents (priceCents, monthlyFeeCents, annualTaxCents). minArea is square metres. Without status, pending and sold listings are included: pass status \"active\" for homes still for sale.",
      input: {
        city: z.string().optional(),
        neighbourhood: z.string().optional(),
        types: z.array(z.enum(HOME_TYPES)).optional().describe("Any of these home types"),
        minPrice: z.number().nonnegative().optional(),
        maxPrice: z.number().positive().optional(),
        minBeds: count(),
        minBaths: count(),
        minArea: z.number().nonnegative().optional(),
        minYearBuilt: z.number().int().optional(),
        features: z.array(z.enum(HOME_FEATURES)).optional().describe("Features every listing must have"),
        status: z.enum(HOME_LISTING_STATUSES).optional(),
      },
      handler: (a, c) => c.homes.search(c.workspaceId, toQuery({ ...a, type: a.types ?? [], features: a.features ?? [] })),
    })
    .register({
      name: "get_listing",
      description: "One listing by its code (LS-…): price, size, features, monthly service fee and annual property tax in cents, status, and the listing agent.",
      input: { listingCode: z.string() },
      handler: async (a, c) => (await c.homes.getListing(c.workspaceId, a.listingCode)) ?? notFound(`listing ${a.listingCode}`),
    })
    .register({
      name: "get_agent",
      description: "One listing agent by code (AG-…) with the days and hours they show homes.",
      input: { agentCode: z.string() },
      handler: async (a, c) => (await c.homes.getAgent(c.workspaceId, a.agentCode)) ?? notFound(`agent ${a.agentCode}`),
    })
    .register({
      name: "list_viewing_slots",
      description: "The 30-minute viewing slots of a listing's agent in the viewing window, in time order, each marked free or taken. from: only slots starting at or after this moment (YYYY-MM-DDTHH:MM); freeOnly: only free ones.",
      input: { listingCode: z.string(), from: moment.optional(), freeOnly: z.boolean().optional() },
      handler: (a, c) => c.homes.slots(c.workspaceId, a.listingCode, { ...(a.from ? { from: a.from } : {}), freeOnly: !!a.freeOnly }),
    })
    .register({
      name: "list_viewings",
      description: "Viewing requests, optionally for one viewer email, one listing, one agent, or one status (requested|cancelled). Paginated via cursor.",
      input: {
        email: z.string().optional(),
        listingCode: z.string().optional(),
        agentCode: z.string().optional(),
        status: z.enum(["requested", "cancelled"]).optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      handler: (a, c) =>
        c.homes.listViewings(c.workspaceId, {
          ...(a.email ? { email: a.email } : {}),
          ...(a.listingCode ? { listing: a.listingCode } : {}),
          ...(a.agentCode ? { agent: a.agentCode } : {}),
          ...(a.status ? { status: a.status } : {}),
          ...(a.cursor ? { cursor: a.cursor } : {}),
          limit: a.limit ?? 25,
        }),
    })
    .register({
      name: "get_viewing",
      description: "One viewing request by its number (VW-…).",
      input: { viewingNo: z.string() },
      handler: async (a, c) => (await c.homes.getViewing(c.workspaceId, a.viewingNo)) ?? notFound(`viewing ${a.viewingNo}`),
    })
    .register({
      name: "request_viewing",
      description:
        "Request a viewing of a listing in one of its agent's slots (date + start time, 24-hour HH:MM). Fails if the listing is not active, the date is outside the viewing window, the agent has no slot then, the slot is taken, or the viewer already has a viewing at that time.",
      input: { listingCode: z.string(), agentCode: z.string().optional(), date: dateOf(), time: timeOf(), viewerName: z.string(), viewerEmail: z.string().email() },
      handler: (a, c) => c.homes.requestViewing(c.workspaceId, a),
    })
    .register({
      name: "cancel_viewing",
      description: "Cancel a requested viewing; its slot becomes free again. A cancelled request cannot be restored; request again instead.",
      input: { viewingNo: z.string() },
      handler: (a, c) => c.homes.cancelViewing(c.workspaceId, a.viewingNo),
    });
}
