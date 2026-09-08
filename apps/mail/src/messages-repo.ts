import type { Pool } from "@benchme/core";
import { randomBytes } from "node:crypto";

export type Message = { id: string; from: string; to: string; subject: string; body: string; receivedAt: string; readAt: string | null };

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
    let where = "workspace_id = $1";
    if (to) {
      params.push(to.toLowerCase());
      where += " AND to_addr = $3";
    }
    const r = await this.pool.query<Row>(`SELECT * FROM mail.messages WHERE ${where} ORDER BY received_at DESC LIMIT $2`, params);
    return r.rows.map(toMsg);
  }

  async get(ws: string, id: string, markRead: boolean): Promise<Message | null> {
    const r = markRead
      ? await this.pool.query<Row>("UPDATE mail.messages SET read_at = COALESCE(read_at, now()) WHERE workspace_id = $1 AND id = $2 RETURNING *", [ws, id])
      : await this.pool.query<Row>("SELECT * FROM mail.messages WHERE workspace_id = $1 AND id = $2", [ws, id]);
    return r.rows[0] ? toMsg(r.rows[0]) : null;
  }
}
