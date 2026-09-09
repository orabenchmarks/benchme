import { type Rng, int, pick } from "../prng.js";
import type { Agent, Comment, SlaPolicy, Ticket } from "../scenario.js";
import { personName, word } from "./names.js";

const TEAMS = ["tier-1", "tier-2", "billing", "logistics"] as const;
const PRIORITIES = ["low", "normal", "normal", "normal", "high", "high", "urgent"] as const;
const STATUSES = ["open", "open", "open", "pending", "resolved", "resolved", "closed"] as const;
const SUBJECTS = [
  "Delivery of order {o} arrived damaged",
  "Wrong quantity received for {s}",
  "Invoice for {o} does not match the quote",
  "Cannot log in to the customer portal",
  "Request for a datasheet on {s}",
  "Transfer {t} still pending after two days",
  "Duplicate charge on order {o}",
  "Need a replacement for {s} under warranty",
  "Pricing question for gold tier",
  "Update the shipping address on {o}",
] as const;

export function agents(rng: Rng): Agent[] {
  return Array.from({ length: 8 }, (_, i) => ({ code: `AG-${String(10 + i)}`, name: personName(rng), team: TEAMS[i % TEAMS.length] as string }));
}

export function slaPolicies(): SlaPolicy[] {
  return [
    { priority: "low", respondHours: 48, resolveHours: 240 },
    { priority: "normal", respondHours: 24, resolveHours: 120 },
    { priority: "high", respondHours: 8, resolveHours: 48 },
    { priority: "urgent", respondHours: 1, resolveHours: 8 },
  ];
}

export function tickets(rng: Rng, count: number, ag: Agent[], customers: string[], orders: string[], skus: string[], transfers: string[]): { tickets: Ticket[]; comments: Comment[] } {
  const out: Ticket[] = [];
  const comments: Comment[] = [];
  for (let i = 0; i < count; i++) {
    const ticketNo = `HD-${String(5000 + i)}`;
    const subject = pick(rng, SUBJECTS)
      .replace("{o}", pick(rng, orders))
      .replace("{s}", pick(rng, skus))
      .replace("{t}", pick(rng, transfers));
    const status = pick(rng, STATUSES);
    const day = int(rng, 0, 120);
    const opened = new Date(Date.UTC(2026, 2, 1 + day, int(rng, 7, 18), int(rng, 0, 59)));
    const assigned = status === "open" && rng() < 0.35 ? null : pick(rng, ag).code;
    const resolved = status === "resolved" || status === "closed" ? new Date(opened.getTime() + int(rng, 1, 200) * 3_600_000) : null;
    out.push({
      ticketNo,
      subject,
      body: `${subject}. ${word(rng)} ${word(rng)} reported by the customer; see the order history for context.`,
      requester: pick(rng, customers),
      priority: pick(rng, PRIORITIES),
      status,
      assigneeCode: assigned,
      openedAt: opened.toISOString(),
      resolvedAt: resolved ? resolved.toISOString() : null,
    });
    const n = int(rng, 0, 4);
    for (let c = 1; c <= n; c++) {
      comments.push({
        ticketNo,
        seq: c,
        author: c % 2 === 1 && assigned ? assigned : "customer",
        body: `${pick(rng, ["Thanks, looking into it.", "Could you share the packing slip?", "Escalated to the depot.", "Replacement dispatched.", "Please confirm the quantity received.", "Credit note issued."])}`,
        internal: rng() < 0.2,
        createdAt: new Date(opened.getTime() + c * int(rng, 1, 30) * 3_600_000).toISOString(),
      });
    }
  }
  return { tickets: out, comments };
}
