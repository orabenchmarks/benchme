import type { HomeAgent } from "@benchme/scenarios";
import { esc } from "@benchme/site-kit";
import type { AgentDetail } from "../../db/homes-repo.js";

export function agentsList(p: string, agents: HomeAgent[]): string {
  const rows = agents.map((a) => `<tr><td><a href="${p}/agents/${esc(a.code)}">${esc(a.name)}</a></td><td><code>${esc(a.code)}</code></td><td>${esc(a.city)}</td><td>${esc(a.email)}</td></tr>`).join("");
  return `<h1>Agents</h1><table><tr><th>Agent</th><th>Code</th><th>City</th><th>Email</th></tr>${rows}</table>`;
}

export function agentDetail(p: string, a: AgentDetail): string {
  const days = a.days.map((d) => `<tr><td>${esc(d.date)}</td><td>${esc(d.from)} to ${esc(d.until)}</td></tr>`).join("");
  return `<h1>${esc(a.name)} <code>${esc(a.code)}</code></h1><p>${esc(a.city)} · ${esc(a.email)} · <a href="${p}/listings?city=${encodeURIComponent(a.city)}">listings in ${esc(a.city)}</a></p>
<h2>Viewing days</h2><table><tr><th>Date</th><th>Hours (30-minute slots)</th></tr>${days || "<tr><td colspan=2>None.</td></tr>"}</table>`;
}
