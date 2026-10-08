/**
 * The wallet's vocabulary: Link's spend-request statuses, the test cards it issues, and what a request is
 * bound to. Wire shapes (what link-cli parses) live in view.ts; inputs in spend-request-input.ts.
 */

/** Link's status names (link-cli 0.26.0 polls created, pending_approval and auto-resuming requires_action). */
export const STATUSES = ["created", "pending_approval", "approved", "requires_action", "denied", "expired", "canceled"] as const;
export type Status = (typeof STATUSES)[number];

/** Statuses a request can still leave on its own or by a call; the rest are final. */
export const ACTIVE_STATUSES: readonly Status[] = ["created", "pending_approval", "approved", "requires_action"];

/** Which test card a decision issues: what the bound store's scenario calls for. */
export type CardKind = "success" | "3ds" | "decline";

/** The card handed to the session that owns an approved request (`retrieve --include card`). */
export type IssuedCard = {
  id: string;
  kind: CardKind;
  brand: string;
  number: string;
  cvc: string;
  expMonth: number;
  expYear: number;
};

/** The store checkout of one workspace a request pays for, and the card that store's scenario calls for. */
export type BoundTo = {
  workspace: string;
  store: string;
  checkout: string | null;
  scenarioId: string | null;
  card: CardKind;
};

/**
 * What a request is bound to (DESIGN §6.3). When it is decided: a store checkout of one workspace — by the
 * workspace path in its merchant_url, by the Checkout Session of the hosted page it names, or by its exact
 * amount among a store's open checkouts — or, when none yields exactly one, nothing (`fallback`, and the run is
 * flagged): the card every checkout a rule found calls for, when they all call for the same one (`card` — the
 * runs of one task share their scenario), else the plain success card. A fallback request is bound later, when a
 * store is paid with its card (`payment`, which keeps why it fell back: the run stays flagged). `unavailable`: a
 * rule could not ask the stores and none bound the request, so its card is not known — the request is never
 * issued a guess (it stays pending, then is denied, flagged; SpendRequestService.decide).
 */
export type Binding =
  | ({ rule: "workspace" | "session" | "amount" } & BoundTo)
  | ({ rule: "payment"; fellBack: string } & BoundTo)
  | { rule: "fallback"; reason: string; card?: CardKind }
  | { rule: "unavailable"; reason: string };

export type LineItem = Record<string, unknown> & { name: string };
export type Total = { type: string; display_text: string; amount: number };
export type NextAction = {
  type: string;
  resolution: "auto_resume" | "create_new_spend_request" | "create_new_spend_request_after_completion";
  display_message: string;
  action_url: string | null;
};
export type StatusDetails = { requires_action?: { failure_code?: string; next_action: NextAction } } | null;

/** A spend request as stored. */
export type SpendRequestRow = {
  id: string;
  sessionId: string;
  status: Status;
  credentialType: string;
  paymentDetails: string;
  amount: number;
  currency: string;
  merchantName: string | null;
  merchantUrl: string | null;
  context: string;
  lineItems: LineItem[] | null;
  totals: Total[] | null;
  metadata: Record<string, string> | null;
  recurring: { interval: string; interval_count: number } | null;
  test: boolean;
  idempotencyKey: string | null;
  statusDetails: StatusDetails;
  binding: Binding | null;
  card: IssuedCard | null;
  denialReason: string | null;
  approvalRequestedAt: Date | null;
  decidedAt: Date | null;
  approvedAt: Date | null;
  canceledAt: Date | null;
  /** The payment its card was accepted for (the processor's id) and when — once: the card pays one payment (Link's spend controls). */
  usedBy: string | null;
  usedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

/** A connected device (one link-cli login). */
export type Session = { id: string; clientName: string; connectionLabel: string | null; scope: string; createdAt: Date };
