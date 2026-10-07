import { acmeV1 } from "./acme-v1/index.js";
import { ScenarioRegistry } from "./scenario.js";
import { shopsV1 } from "./shops-v1/index.js";

export { ACME_V1_SIZES, acmeV1 } from "./acme-v1/index.js";
export { shopsV1 } from "./shops-v1/index.js";
export { documentsMatching, lowStock, openOrdersFor, openTicketsFor, orderTotalCents, slaBreaches, stockOf } from "./answers.js";
export { int, minstd, pick, shuffle, type Rng } from "./prng.js";
export {
  ScenarioRegistry,
  UnknownScenarioError,
  type Agent,
  type Comment,
  type CompanyFacts,
  type Customer,
  type Document,
  type DocumentKind,
  type Location,
  type Order,
  type OrderLine,
  type OrderStatus,
  type Product,
  type Scenario,
  type ScenarioRows,
  type SlaPolicy,
  type Stock,
  type Ticket,
  type TicketPriority,
  type TicketStatus,
  type Transfer,
  type TransferStatus,
} from "./scenario.js";

/**
 * The default registry with every shipped scenario. acme-v1 stays first: the
 * gateway's robots.txt advertises the shared workspace of the first one.
 */
export const scenarios = new ScenarioRegistry().register(acmeV1).register(shopsV1);
