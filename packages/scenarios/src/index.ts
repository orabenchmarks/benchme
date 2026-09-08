import { acmeV1 } from "./acme-v1/index.js";
import { ScenarioRegistry } from "./scenario.js";

export { ACME_V1_SIZES, acmeV1 } from "./acme-v1/index.js";
export { lowStock, openOrdersFor, orderTotalCents, stockOf } from "./answers.js";
export { int, minstd, pick, shuffle, type Rng } from "./prng.js";
export {
  ScenarioRegistry,
  UnknownScenarioError,
  type CompanyFacts,
  type Customer,
  type Location,
  type Order,
  type OrderLine,
  type OrderStatus,
  type Product,
  type Scenario,
  type ScenarioRows,
  type Stock,
  type Transfer,
  type TransferStatus,
} from "./scenario.js";

/** The default registry with every shipped scenario. */
export const scenarios = new ScenarioRegistry().register(acmeV1);
