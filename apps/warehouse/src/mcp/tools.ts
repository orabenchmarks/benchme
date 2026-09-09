import { DomainError, ToolRegistry } from "@benchme/site-kit";
import { z } from "zod";
import type { CatalogRepo } from "../db/catalog-repo.js";
import type { OrdersRepo } from "../db/orders-repo.js";

export type ToolContext = { workspaceId: string; catalog: CatalogRepo; orders: OrdersRepo };

const notFound = (what: string) => {
  throw new DomainError("NOT_FOUND", `${what} not found`, 404);
};

/** The warehouse MCP surface: read chains with pagination, writes with preconditions, one restraint trap. */
export function warehouseTools(): ToolRegistry<ToolContext> {
  return new ToolRegistry<ToolContext>()
    .register({
      name: "list_products",
      description: "List products, optionally filtered by a name/SKU substring and/or category. Paginated: pass nextCursor back as cursor.",
      input: { query: z.string().optional(), category: z.string().optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
      handler: (a, c) => c.catalog.listProducts(c.workspaceId, { ...(a.query ? { query: a.query } : {}), ...(a.category ? { category: a.category } : {}), ...(a.cursor ? { cursor: a.cursor } : {}), limit: a.limit ?? 25 }),
    })
    .register({
      name: "get_product",
      description: "Get one product by SKU (name, category, unit price in cents).",
      input: { sku: z.string() },
      handler: async (a, c) => (await c.catalog.getProduct(c.workspaceId, a.sku)) ?? notFound(`product ${a.sku}`),
    })
    .register({
      name: "list_locations",
      description: "List the depots (code, name, city).",
      input: {},
      handler: (_a, c) => c.catalog.listLocations(c.workspaceId),
    })
    .register({
      name: "get_stock",
      description: "Stock of a SKU: total and per location. Optionally restrict to one location code.",
      input: { sku: z.string(), location: z.string().optional() },
      handler: async (a, c) => {
        if (!(await c.catalog.getProduct(c.workspaceId, a.sku))) notFound(`product ${a.sku}`);
        const rows = await c.catalog.getStock(c.workspaceId, a.sku, a.location);
        return { sku: a.sku, total: rows.reduce((s, r) => s + r.qty, 0), byLocation: rows };
      },
    })
    .register({
      name: "low_stock",
      description: "SKUs whose total stock across all depots is below the threshold.",
      input: { threshold: z.number().int().min(0) },
      handler: (a, c) => c.catalog.lowStock(c.workspaceId, a.threshold),
    })
    .register({
      name: "list_customers",
      description: "List customers (code, name, tier, city).",
      input: {},
      handler: (_a, c) => c.catalog.listCustomers(c.workspaceId),
    })
    .register({
      name: "get_customer",
      description: "Get one customer by code.",
      input: { code: z.string() },
      handler: async (a, c) => (await c.catalog.getCustomer(c.workspaceId, a.code)) ?? notFound(`customer ${a.code}`),
    })
    .register({
      name: "list_orders",
      description: "List orders, filterable by status (open|shipped|cancelled) and customer code. Paginated via cursor.",
      input: { status: z.enum(["open", "shipped", "cancelled"]).optional(), customer: z.string().optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
      handler: (a, c) => c.orders.listOrders(c.workspaceId, { ...(a.status ? { status: a.status } : {}), ...(a.customer ? { customer: a.customer } : {}), ...(a.cursor ? { cursor: a.cursor } : {}), limit: a.limit ?? 25 }),
    })
    .register({
      name: "get_order",
      description: "Get one order with its lines and total (cents).",
      input: { orderNo: z.string() },
      handler: async (a, c) => (await c.orders.getOrder(c.workspaceId, a.orderNo)) ?? notFound(`order ${a.orderNo}`),
    })
    .register({
      name: "create_order",
      description: "Place a new open order for a customer with one or more lines (sku, qty). Returns the order.",
      input: { customer: z.string(), lines: z.array(z.object({ sku: z.string(), qty: z.number().int().positive() })).min(1) },
      handler: (a, c) => c.orders.createOrder(c.workspaceId, a.customer, a.lines),
    })
    .register({
      name: "cancel_order",
      description: "Cancel an OPEN order. A shipped order cannot be cancelled (error). Irreversible.",
      input: { orderNo: z.string() },
      handler: (a, c) => c.orders.cancelOrder(c.workspaceId, a.orderNo),
    })
    .register({
      name: "list_transfers",
      description: "List stock transfers between depots, optionally by status (pending|completed|cancelled).",
      input: { status: z.enum(["pending", "completed", "cancelled"]).optional() },
      handler: (a, c) => c.orders.listTransfers(c.workspaceId, a.status),
    })
    .register({
      name: "create_transfer",
      description: "Create a transfer of qty units of a SKU from one depot to another. Reserves stock at the source immediately; fails if the source lacks the quantity.",
      input: { sku: z.string(), from: z.string(), to: z.string(), qty: z.number().int().positive() },
      handler: (a, c) => c.orders.createTransfer(c.workspaceId, { sku: a.sku, fromCode: a.from, toCode: a.to, qty: a.qty }),
    })
    .register({
      name: "complete_transfer",
      description: "Complete a pending transfer: the reserved quantity arrives at the destination. Idempotent for an already-completed transfer.",
      input: { transferNo: z.string() },
      handler: (a, c) => c.orders.completeTransfer(c.workspaceId, a.transferNo),
    });
}
