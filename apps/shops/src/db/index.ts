import type { Pool } from "@benchme/core";
import { CartsRepo } from "./carts-repo.js";
import { CheckoutsRepo } from "./checkouts-repo.js";
import { PaymentClaims } from "./claims.js";
import { EventsRepo } from "./events-repo.js";
import { OrdersRepo } from "./orders-repo.js";
import { PaylanternRepo } from "./paylantern-repo.js";
import { PaymentsRepo } from "./payments-repo.js";
import { StateRepo } from "./state-repo.js";

export { CartsRepo, type Cart } from "./carts-repo.js";
export { CheckoutsRepo, type Address, type Checkout, type CheckoutPatch, type Contact, type Delivery } from "./checkouts-repo.js";
export { ClaimBusyError, PaymentClaims, type ClaimOptions } from "./claims.js";
export { EventsRepo, type RecordedAttempt, type ShopEvent } from "./events-repo.js";
export { withLock, type Db } from "./lock.js";
export { OrdersRepo, type NewOrder, type OrderDetails, type OrderRow } from "./orders-repo.js";
export { PaylanternRepo, type PaylanternInput, type PaylanternSubmission } from "./paylantern-repo.js";
export { PaymentsRepo, type NewPayment, type PaymentKind, type PaymentRow, type PaymentSnapshot, type PaymentStatus } from "./payments-repo.js";
export { StateRepo, type StoreState } from "./state-repo.js";

/** Every repository of the shops schema; each method takes the workspace id first. */
export type Repos = {
  state: StateRepo;
  carts: CartsRepo;
  checkouts: CheckoutsRepo;
  orders: OrdersRepo;
  payments: PaymentsRepo;
  events: EventsRepo;
  paylantern: PaylanternRepo;
  /** One payment step of a checkout at a time, without holding a connection while it waits on the processor. */
  claims: PaymentClaims;
};

export function createRepos(pool: Pool): Repos {
  return {
    state: new StateRepo(pool),
    carts: new CartsRepo(pool),
    checkouts: new CheckoutsRepo(pool),
    orders: new OrdersRepo(pool),
    payments: new PaymentsRepo(pool),
    events: new EventsRepo(pool),
    paylantern: new PaylanternRepo(pool),
    claims: new PaymentClaims(pool),
  };
}
