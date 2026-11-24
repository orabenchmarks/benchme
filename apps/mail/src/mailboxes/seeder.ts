import { mailboxesOf, type Mailboxes, type ScenarioRegistry } from "@benchme/scenarios";
import type { HeldAddressesRepo } from "./held-repo.js";
import { MAILBOX_POLICIES, type MailboxPolicy } from "./policies.js";

/**
 * What the inbox does when the gateway seeds a workspace. No message is made (an inbox starts empty), but when the
 * scenario's mailboxes are private its people's addresses are held, from the rows its seed generates: the rows every
 * site of the workspace is seeded with, so whoever a site already knows is held. An unknown scenario throws
 * UnknownScenarioError, as it does at every site.
 */
export class MailboxesSeeder {
  constructor(
    private readonly scenarios: ScenarioRegistry,
    private readonly held: HeldAddressesRepo,
    private readonly policies: Readonly<Record<Mailboxes, MailboxPolicy>> = MAILBOX_POLICIES,
  ) {}

  async seed(ws: string, scenarioKey: string, seed: number): Promise<{ mailboxes: Mailboxes; held: number }> {
    const scenario = this.scenarios.get(scenarioKey);
    const mailboxes = mailboxesOf(scenario);
    const addresses = this.policies[mailboxes].held(scenario, seed);
    await this.held.replace(ws, addresses);
    return { mailboxes, held: addresses.length };
  }
}
