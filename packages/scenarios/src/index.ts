import { acmeV1 } from "./acme-v1/index.js";
import { guideV1 } from "./guide-v1/index.js";
import { ScenarioRegistry } from "./scenario.js";
import { shopsV1 } from "./shops-v1/index.js";
import { webV1 } from "./web-v1/index.js";
import { webmcpV1 } from "./webmcp-v1/index.js";
import { cujV1 } from "./cuj-v1/index.js";

export { ACME_V1_SIZES, acmeV1 } from "./acme-v1/index.js";
export { AMENITIES, HOTEL_SIZES } from "./sites/hotels/generate.js";
export { shopsV1 } from "./shops-v1/index.js";
export { guideV1 } from "./guide-v1/index.js";
export { webV1 } from "./web-v1/index.js";
export { webmcpV1 } from "./webmcp-v1/index.js";
export { cujV1 } from "./cuj-v1/index.js";
export { ACCOUNTS_PER_SITE, siteAccounts } from "./cuj-v1/accounts.js";
export { SITE_APPS, noSiteRows, siteRows, type SiteApp, type SiteRows } from "./sites/rows.js";
export * from "./sites/flights/index.js";
export * from "./sites/dining/index.js";
export * from "./sites/pizza/index.js";
export * from "./sites/cinema/index.js";
export * from "./sites/sports/index.js";
export * from "./sites/homes/index.js";
export * from "./sites/clinic/index.js";
export * from "./sites/events/index.js";
export { documentsMatching, lowStock, openOrdersFor, openTicketsFor, orderTotalCents, slaBreaches, stockOf } from "./answers.js";
export { int, minstd, pick, shuffle, substream, type Rng } from "./prng.js";
export {
  MAX_NIGHTS,
  STAY_WINDOW,
  addDays,
  checkOutOf,
  fitProblem,
  isDate,
  nightsOf,
  roomsLeft,
  searchStays,
  stayProblem,
  stayTotalCents,
  type Stay,
  type StayOffer,
  type StayProblem,
  type StayQuery,
} from "./stays.js";
export {
  ScenarioRegistry,
  UnknownScenarioError,
  type Agent,
  type Booking,
  type BookingStatus,
  type Comment,
  type CompanyFacts,
  type Customer,
  type Document,
  type DocumentKind,
  type Hotel,
  type HotelRows,
  type Location,
  type Order,
  type OrderLine,
  type OrderStatus,
  type Product,
  type RoomType,
  type Scenario,
  type ScenarioRows,
  type SiteAccount,
  type SiteAccounts,
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
export const scenarios = new ScenarioRegistry().register(acmeV1).register(shopsV1).register(guideV1).register(webV1).register(webmcpV1).register(cujV1);
