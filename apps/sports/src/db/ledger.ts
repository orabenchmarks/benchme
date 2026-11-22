import { about, read, unrecorded, write, type LedgerRules } from "@benchme/site-kit";
import type { CatalogRepo } from "./catalog-repo.js";
import type { OrdersRepo } from "./orders-repo.js";

/** What the store's ledger keeps of its catalogue: the reads of one product or one variant. */
export const CATALOG_LEDGER: LedgerRules<CatalogRepo> = {
  policies: unrecorded,
  facets: unrecorded,
  listProducts: unrecorded,
  search: unrecorded,
  getProduct: read("product", ([code]) => code),
  getVariant: read("variant", ([sku]) => sku),
};

/** And of its orders: the reads of one customer or order, and the four writes. A reorder's entity is the new order; a return is its own. */
export const ORDERS_LEDGER: LedgerRules<OrdersRepo> = {
  listCustomers: unrecorded,
  listOrders: unrecorded,
  listReturns: unrecorded,
  getCustomer: read("customer", ([email]) => email),
  getOrder: read("order", ([orderNo]) => orderNo),
  placeOrder: write("order", "create", (_args, order) => order?.orderNo, about("customer", ([req]) => req.customerEmail)),
  cancelOrder: write("order", "cancel", ([orderNo]) => orderNo),
  reorder: write("order", "reorder", (_args, order) => order?.orderNo, about("order", ([orderNo]) => orderNo)),
  requestReturn: write("return", "create", (_args, ret) => ret?.returnNo, about("order", ([req]) => req.orderNo)),
};
