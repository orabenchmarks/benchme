import { DomainError, ToolRegistry } from "@benchme/site-kit";
import { z } from "zod";
import { STATUSES, date, toOrderFilter, toSearch } from "../api/inputs.js";
import type { CatalogRepo } from "../db/catalog-repo.js";
import type { OrdersRepo } from "../db/orders-repo.js";

export type ToolContext = { workspaceId: string; catalog: CatalogRepo; orders: OrdersRepo };

const notFound = (what: string) => {
  throw new DomainError("NOT_FOUND", `${what} not found`, 404);
};
const lines = z.array(z.object({ sku: z.string(), qty: z.number().int() })).describe('The order lines, e.g. [{"sku": "SP-101-BLK-42", "qty": 1}]');

/** The sports site's MCP surface (and, through the bridge, its WebMCP tools): policies, catalog search, customers, orders, returns. */
export function sportsTools(): ToolRegistry<ToolContext> {
  return new ToolRegistry<ToolContext>()
    .register({
      name: "get_store_policies",
      description: "The store's rules: each category's return window in days (counted from the day an order was delivered), the shipping fee and the subtotal from which shipping is free (cents), the accepted return reasons, and the site's current date.",
      input: {},
      handler: (_a, c) => c.catalog.policies(c.workspaceId),
    })
    .register({
      name: "search_products",
      description:
        "Product variants matching every given filter, cheapest first: words in the name, brand, category or material; a category key; an exact size and colour; maxPrice in dollars; maxWeight in grams; inStock to drop variants with no stock. Each result has its SKU, price in cents, weight and stock.",
      input: {
        query: z.string().optional(),
        category: z.string().optional(),
        size: z.string().optional().describe('e.g. "42", "M", "G3", "one size"'),
        colour: z.string().optional(),
        maxPrice: z.number().positive().optional(),
        maxWeight: z.number().int().positive().optional(),
        inStock: z.boolean().optional(),
      },
      handler: (a, c) => c.catalog.search(c.workspaceId, toSearch(a)),
    })
    .register({
      name: "get_product",
      description: "One product (SP-…): brand, category, material, and every variant with its SKU, size, colour, weight in grams, price in cents and stock.",
      input: { productCode: z.string() },
      handler: async (a, c) => (await c.catalog.getProduct(c.workspaceId, a.productCode)) ?? notFound(`product ${a.productCode}`),
    })
    .register({
      name: "get_customer",
      description: "A customer account by email, with its saved addresses (AD-…; one is the default).",
      input: { email: z.string() },
      handler: async (a, c) => (await c.orders.getCustomer(c.workspaceId, a.email)) ?? notFound(`customer ${a.email}`),
    })
    .register({
      name: "list_orders",
      description:
        "Orders, optionally for one customer email, one status (processing|shipped|delivered|cancelled), or placed within a timeframe (placedFrom / placedTo, YYYY-MM-DD, inclusive). Each order has its status, dates, tracking number, delivery address and lines. Paginated via cursor.",
      input: {
        customerEmail: z.string().optional(),
        status: z.enum(STATUSES).optional(),
        placedFrom: date.optional(),
        placedTo: date.optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      handler: (a, c) => c.orders.listOrders(c.workspaceId, toOrderFilter({ ...a, limit: a.limit ?? 25 })),
    })
    .register({
      name: "get_order",
      description: "One order by its number (ORD-…): status, placed / shipped / delivered dates, tracking number, delivery address, lines (with units already returned) and returns.",
      input: { orderNo: z.string() },
      handler: async (a, c) => (await c.orders.getOrder(c.workspaceId, a.orderNo)) ?? notFound(`order ${a.orderNo}`),
    })
    .register({
      name: "place_order",
      description:
        "Place an order for a customer, shipped to one of their saved addresses. Up to 8 lines, 1–10 units each, no SKU twice. Every line's units are reserved from stock; an out-of-stock line refuses the whole order. Shipping is the store's fee unless the subtotal reaches the free-shipping threshold.",
      input: { customerEmail: z.string(), addressCode: z.string(), lines },
      handler: (a, c) => c.orders.placeOrder(c.workspaceId, a),
    })
    .register({
      name: "cancel_order",
      description: "Cancel an order that is still processing; its stock is released. A shipped or delivered order cannot be cancelled.",
      input: { orderNo: z.string() },
      handler: (a, c) => c.orders.cancelOrder(c.workspaceId, a.orderNo),
    })
    .register({
      name: "reorder",
      description: "Place a new order with the same SKUs and quantities as an earlier order, for the same customer, to the same address unless addressCode names another of their saved addresses. Current prices and stock apply.",
      input: { orderNo: z.string(), addressCode: z.string().optional() },
      handler: (a, c) => c.orders.reorder(c.workspaceId, a.orderNo, a.addressCode),
    })
    .register({
      name: "request_return",
      description:
        "Request the return of some units of one line of a delivered order, with a reason from the store's list. Refused once the line's return window (its category's days after delivery) has passed, or for more units than were bought minus those already returned.",
      input: { orderNo: z.string(), sku: z.string(), qty: z.number().int(), reason: z.string().describe('one of "too small", "too large", "defective", "not as described", "no longer needed"') },
      handler: (a, c) => c.orders.requestReturn(c.workspaceId, a),
    });
}
