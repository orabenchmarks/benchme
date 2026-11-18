/**
 * The home listings site (apps/homes): homes for sale, the agents who list
 * them, the agents' viewing hours, and viewing requests. Prices and fees are
 * cents. Rules: ./rules.ts.
 */
export type HomeType = "house" | "apartment" | "townhouse";
export type HomeListingStatus = "active" | "pending" | "sold";

export type HomeAgent = { code: string; name: string; city: string; email: string };

export type HomeListing = {
  code: string;
  city: string;
  neighbourhood: string;
  address: string;
  type: HomeType;
  priceCents: number;
  beds: number;
  baths: number;
  /** Floor area in square metres. */
  areaSqm: number;
  yearBuilt: number;
  features: string[];
  /** The monthly HOA / service fee; 0 where there is none. */
  monthlyFeeCents: number;
  annualTaxCents: number;
  /** Only an active listing can be viewed. */
  status: HomeListingStatus;
  /** "YYYY-MM-DD". */
  listedOn: string;
  agentCode: string;
  description: string;
};

/** One day an agent shows homes: 30-minute slots start at `from` and the last one ends at `until` ("HH:MM"). */
export type HomeAgentDay = { agentCode: string; date: string; from: string; until: string };

export type HomeViewingStatus = "requested" | "cancelled";
export type HomeViewing = {
  viewingNo: string;
  listingCode: string;
  agentCode: string;
  /** The slot: "YYYY-MM-DD" and its start "HH:MM". */
  date: string;
  time: string;
  viewerName: string;
  viewerEmail: string;
  status: HomeViewingStatus;
  createdAt: string;
};

export type HomeRows = { agents: HomeAgent[]; listings: HomeListing[]; agentDays: HomeAgentDay[]; viewings: HomeViewing[] };
