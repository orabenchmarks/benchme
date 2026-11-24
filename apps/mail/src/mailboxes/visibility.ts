import type { HeldAddressesRepo } from "./held-repo.js";

/**
 * Which stored messages a read of the inbox returns: all of them but the mail to an address the workspace holds
 * (./held-repo.ts), which belongs in that person's own mailbox, never in the inbox an agent reads. Delivery stores it
 * all the same, so nothing is lost; no read returns it, and asked for by its id it answers as a message that never
 * was. A workspace that holds no address (every workspace of a scenario with shared mailboxes) shows every message.
 *
 * A condition on `mail.messages` aliased `m`, for the WHERE of every read, so a list's LIMIT counts only what is
 * shown and a hidden message is never marked read. `to_addr` is stored lower-cased; trimming it too compares it the
 * way a site keys an account by its email.
 */
export const SHOWN_IN_INBOX = "NOT EXISTS (SELECT 1 FROM mail.held_addresses h WHERE h.workspace_id = m.workspace_id AND h.address = lower(btrim(m.to_addr)))";

/** The one line a private workspace's inbox page carries: why the mail a site sends to some people never shows here. */
export const PRIVATE_MAILBOXES_NOTE = '<p role="note">Mail to people who already exist in this workspace goes to their own mailboxes and is not shown here.</p>';

/** The inbox page's note for one workspace: that line when its people's mailboxes are private, nothing otherwise. */
export const inboxNote = async (held: HeldAddressesRepo, ws: string): Promise<string> => ((await held.any(ws)) ? PRIVATE_MAILBOXES_NOTE : "");
