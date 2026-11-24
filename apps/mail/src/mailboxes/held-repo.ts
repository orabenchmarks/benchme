import { withTx, type Pool } from "@benchme/core";

/** Per workspace, the addresses with a mailbox of their own: what the inbox keeps out of sight (./visibility.ts). */
export interface HeldAddressesRepo {
  /** Makes `addresses` the workspace's held set, atomically: a re-seed replaces it, as every app's seed replaces its rows. */
  replace(ws: string, addresses: readonly string[]): Promise<void>;
  /** Whether the workspace holds any address, which is what makes its people's mailboxes private. */
  any(ws: string): Promise<boolean>;
}

export class PgHeldAddressesRepo implements HeldAddressesRepo {
  constructor(private readonly pool: Pool) {}

  async replace(ws: string, addresses: readonly string[]): Promise<void> {
    await withTx(this.pool, async (c) => {
      await c.query("DELETE FROM mail.held_addresses WHERE workspace_id = $1", [ws]);
      if (addresses.length > 0) {
        await c.query("INSERT INTO mail.held_addresses (workspace_id, address) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING", [ws, addresses]);
      }
    });
  }

  async any(ws: string): Promise<boolean> {
    return ((await this.pool.query("SELECT 1 FROM mail.held_addresses WHERE workspace_id = $1 LIMIT 1", [ws])).rowCount ?? 0) > 0;
  }
}
