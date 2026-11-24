import type { Mailboxes, Scenario } from "@benchme/scenarios";
import { heldAddressesOf } from "./held-addresses.js";

/** What one kind of mailboxes (`Scenario.mailboxes`) keeps out of the workspace inbox: the addresses a seed stores. */
export interface MailboxPolicy {
  held(scenario: Scenario, seed: number): string[];
}

/**
 * One policy per kind, never a switch on it: a kind added to `MAILBOXES` does not compile until it has one here.
 * Only `private` generates the rows; a shared workspace's seed costs nothing.
 */
export const MAILBOX_POLICIES: Readonly<Record<Mailboxes, MailboxPolicy>> = {
  /** One inbox for everyone: nothing is held, every message is shown. */
  shared: { held: () => [] },
  /** Everyone the rows hold has a mailbox of their own; any other address's mail is shown. */
  private: { held: (scenario, seed) => heldAddressesOf(scenario.generate(seed)) },
};
