import type { CheckoutDirectory, CheckoutMatch } from "../binding/checkout-directory.js";
import type { EventsRepo } from "../db/events-repo.js";
import type { SavedCardsRepo } from "../db/saved-cards-repo.js";
import { issueCard, lastFour } from "../domain/cards.js";
import { chooseSavedCard, type DoorOutcome } from "../domain/saved-card.js";
import type { IssuedCard } from "../domain/types.js";

/** How a read reached the door: the format answered and the client that asked (for the records). */
export type DoorRead = { format: "html" | "json"; userAgent: string | null };

export type DoorAnswer = { outcome: "shown"; card: IssuedCard } | { outcome: Exclude<DoorOutcome, "shown">; card: null };

export type CardOnFileDeps = {
  directory: CheckoutDirectory;
  cards: SavedCardsRepo;
  events: EventsRepo;
  now: () => Date;
};

/**
 * The card-on-file door (README § Wallet): the buyer's saved card for a run that pays without Link. A read shows
 * the workspace the card its store's scenario calls for — issued on the first read that has one to show, the same
 * card on every later read — and records itself (time, workspace, outcome, the card's kind and last four, the
 * stores) whether or not a card was shown. A store's payment with that card, for a store it was shown for, is a
 * card the wallet issued for the run (`shownFor`).
 */
export class CardOnFileService {
  constructor(private readonly d: CardOnFileDeps) {}

  async read(workspace: string, how: DoorRead): Promise<DoorAnswer> {
    let matches: CheckoutMatch[];
    try {
      matches = await this.d.directory.inWorkspace(workspace, null);
    } catch (err) {
      await this.record(workspace, how, { outcome: "unavailable", card: null, last4: null, stores: [], error: (err as Error).message });
      return { outcome: "unavailable", card: null };
    }
    const choice = chooseSavedCard(matches);
    if (choice.kind === null) {
      await this.record(workspace, how, { outcome: choice.reason, card: null, last4: null, stores: matches.map(shown) });
      return { outcome: choice.reason, card: null };
    }
    const { kind } = choice;
    const stores = choice.stores.map(shown);
    const card = await this.d.cards.issue(workspace, kind, () => issueCard(kind, this.d.now()), stores);
    await this.record(workspace, how, { outcome: "shown", card: kind, last4: lastFour(card.number), stores });
    return { outcome: "shown", card };
  }

  /** Whether the door showed this workspace a card ending `last4` for `store` — a payment with it is the wallet's. */
  shownFor(workspace: string, store: string, last4: string): Promise<boolean> {
    return this.d.cards.shownFor(workspace, store, last4);
  }

  private record(workspace: string, how: DoorRead, data: Record<string, unknown>): Promise<void> {
    return this.d.events.record({ workspace, kind: "card_on_file", data: { ...data, format: how.format, userAgent: how.userAgent } });
  }
}

const shown = (m: CheckoutMatch) => ({ store: m.store, scenarioId: m.scenarioId });
