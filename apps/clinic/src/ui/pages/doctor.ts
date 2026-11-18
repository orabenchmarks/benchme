import { clinicVisitCostCents, type ClinicPlan } from "@benchme/scenarios";
import { esc } from "@benchme/site-kit";
import type { DaySlots, DoctorDetail } from "../../db/catalog-repo.js";
import { WEEKDAYS, cents, field, inline, select, tag, visitText } from "../shell.js";

export type BookParams = { date?: string | undefined; time?: string | undefined; visitType?: string | undefined; planCode?: string | undefined; patientName?: string | undefined; patientEmail?: string | undefined };

/** What one visit costs under each plan: the copay where the doctor is in network, the doctor's fee where not. */
function costTable(p: string, d: DoctorDetail, plans: ClinicPlan[]): string {
  const cell = (plan: ClinicPlan | null, v: "in-person" | "video") => (d.visitTypes.includes(v) ? cents(clinicVisitCostCents(d, plan, v)) : "not offered");
  const rows = plans
    .map((pl) => `<tr><td><a href="${p}/plans/${esc(pl.code)}">${esc(pl.name)}</a> <code>${esc(pl.code)}</code></td><td>${d.networkPlans.includes(pl.code) ? "in network" : "out of network"}</td><td>${cell(pl, "in-person")}</td><td>${cell(pl, "video")}</td></tr>`)
    .join("");
  return `<h2>What a visit costs the patient</h2><table><tr><th>Plan</th><th>Network</th><th>In-person</th><th>Video</th></tr>${rows}
<tr><td>No plan</td><td>—</td><td>${cell(null, "in-person")}</td><td>${cell(null, "video")}</td></tr></table>`;
}

function dayTable(day: DaySlots): string {
  if (day.slots.length === 0) return `<p>No appointments on ${esc(day.date)}: the doctor does not see patients that day.</p>`;
  const rows = day.slots.map((s) => `<tr><td>${esc(s.time)}</td><td>${s.free ? "free" : "taken"}</td></tr>`).join("");
  return `<p>${day.free.length} of ${day.slots.length} slot(s) free on ${esc(day.date)}.</p><table><tr><th>Starts</th><th>Slot</th></tr>${rows}</table>`;
}

function bookForm(p: string, d: DoctorDetail, plans: ClinicPlan[], day: DaySlots | null, b: BookParams): string {
  const times = day?.free.length
    ? select("Time", "time", day.free.map((t) => ({ value: t, text: t })), b.time)
    : field("Time (HH:MM, a slot start)", "time", b.time, 'placeholder="09:30" required');
  return `<h2>Book an appointment</h2><form class="card" method="post" action="${p}/appointments"><input type="hidden" name="doctorCode" value="${esc(d.code)}">
${field("Date (YYYY-MM-DD)", "date", b.date ?? day?.date, 'placeholder="2027-04-12" required')}${times}
${select("Visit type", "visitType", d.visitTypes.map((v) => ({ value: v, text: visitText(v) })), b.visitType)}
${select("Plan", "planCode", [{ value: "", text: "no plan: pay the doctor's fee" }, ...plans.map((pl) => ({ value: pl.code, text: `${pl.name} (${pl.code})` }))], b.planCode)}
${field("Patient name", "patientName", b.patientName, "required")}${field("Patient email", "patientEmail", b.patientEmail, 'type="email" required')}<button>Book</button></form>`;
}

export function doctorDetail(p: string, d: DoctorDetail, plans: ClinicPlan[], day: DaySlots | null, canWrite: boolean, b: BookParams = {}): string {
  const days = d.workDays.map((n) => WEEKDAYS[n]).join(", ");
  return `<h1>${esc(d.name)} <code>${esc(d.code)}</code></h1><p>${esc(d.specialty)} · <a href="${p}/clinics/${esc(d.clinicCode)}">${esc(d.clinicName)}</a>, ${esc(d.city)}</p>
<table><tr><th>Speaks</th><td>${d.languages.map(tag).join(" ")}</td></tr><tr><th>Visit types</th><td>${d.visitTypes.map(tag).join(" ")}</td></tr>
<tr><th>Accepting new patients</th><td>${d.acceptingNewPatients ? "yes" : "no — only patients who already have an appointment with this doctor"}</td></tr>
<tr><th>In network for</th><td>${d.networkPlans.map(tag).join(" ")}</td></tr><tr><th>Fee (out of network)</th><td>in-person ${cents(d.inPersonFeeCents)} · video ${cents(d.videoFeeCents)}</td></tr>
<tr><th>Sees patients</th><td>${esc(days)}, ${d.session === "morning" ? "09:00–12:00" : "13:00–16:00"}, 30-minute slots</td></tr></table>
${costTable(p, d, plans)}
<h2>Appointments on a day</h2><form method="get" action="${p}/doctors/${esc(d.code)}">${field("Date", "date", day?.date, `placeholder="2027-04-12" ${inline}`)} <button style="margin:0">Show the day</button></form>
${day ? dayTable(day) : ""}${canWrite ? bookForm(p, d, plans, day, b) : `<p class="muted">Sign in to book.</p>`}`;
}
