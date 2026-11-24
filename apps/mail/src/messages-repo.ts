import type { Pool } from "@benchme/core";
import { randomBytes } from "node:crypto";
import { SHOWN_IN_INBOX } from "./mailboxes/visibility.js";

export type Message = { id: string; from: string; to: string; subject: string; body: string; receivedAt: string; readAt: string | null };

/** Delivery stores every message; the two reads return only what the inbox shows (SHOWN_IN_INBOX), as every door reads through them. */
export interface MessagesRepo {
  deliver(ws: string, msg: { from: string; to: string; subject: string; body: string }): Promise<Message>;
  list(ws: string, to?: string, limit?: number): Promise<Message[]>;
  get(ws: string, id: string, markRead: boolean): Promise<Message | null>;
}

type Row = { id: string; from_addr: string; to_addr: string; subject: string; body: string; received_at: Date; read_at: Date | null };
const toMsg = (r: Row): Message => ({ id: r.id, from: r.from_addr, to: r.to_addr, subject: r.subject, body: r.body, receivedAt: r.received_at.toISOString(), readAt: r.read_at?.toISOString() ?? null });

export class PgMessagesRepo implements MessagesRepo {
  constructor(private readonly pool: Pool) {}

  async deliver(ws: string, msg: { from: string; to: string; subject: string; body: string }): Promise<Message> {
    const id = `m_${randomBytes(6).toString("hex")}`;
    const r = await this.pool.query<Row>(
      "INSERT INTO mail.messages (workspace_id, id, from_addr, to_addr, subject, body) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
      [ws, id, msg.from, msg.to.toLowerCase(), msg.subject, msg.body],
    );
    return toMsg(r.rows[0] as Row);
  }

  async list(ws: string, to?: string, limit = 100): Promise<Message[]> {
    const params: unknown[] = [ws, limit];
    let where = `m.workspace_id = $1 AND ${SHOWN_IN_INBOX}`;
    if (to) {
      params.push(to.toLowerCase());
      where += " AND m.to_addr = $3";
    }
    const r = await this.pool.query<Row>(`SELECT m.* FROM mail.messages m WHERE ${where} ORDER BY m.received_at DESC LIMIT $2`, params);
    return r.rows.map(toMsg);
  }

  async get(ws: string, id: string, markRead: boolean): Promise<Message | null> {
    const r = markRead
      ? await this.pool.query<Row>(`UPDATE mail.messages m SET read_at = COALESCE(m.read_at, now()) WHERE m.workspace_id = $1 AND m.id = $2 AND ${SHOWN_IN_INBOX} RETURNING m.*`, [ws, id])
      : await this.pool.query<Row>(`SELECT m.* FROM mail.messages m WHERE m.workspace_id = $1 AND m.id = $2 AND ${SHOWN_IN_INBOX}`, [ws, id]);
    return r.rows[0] ? toMsg(r.rows[0]) : null;
  }
}
