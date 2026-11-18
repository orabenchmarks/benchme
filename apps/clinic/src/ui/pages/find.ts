import { CLINIC_LANGUAGES, CLINIC_SPECIALTIES, type Clinic, type ClinicDoctorMatch, type ClinicPlan } from "@benchme/scenarios";
import { esc } from "@benchme/site-kit";
import type { ClinicDetail } from "../../db/catalog-repo.js";
import { cents, field, inline, qs, select, tag } from "../shell.js";

export type FindParams = Record<string, string | undefined>;
const any = { value: "", text: "any" };

/** The find-a-doctor form: every filter the search takes, each optional. */
export function findForm(p: string, clinics: Clinic[], plans: ClinicPlan[], f: FindParams = {}): string {
  const cities = [...new Set(clinics.map((c) => c.city))].sort();
  return `<form class="card" method="get" action="${p}/doctors">
${select("City", "city", [any, ...cities.map((c) => ({ value: c, text: c }))], f.city)}
${select("Specialty", "specialty", [any, ...CLINIC_SPECIALTIES.map((s) => ({ value: s, text: s }))], f.specialty)}
${select("Speaks", "language", [any, ...CLINIC_LANGUAGES.map((l) => ({ value: l, text: l }))], f.language)}
${select("Visit type", "visitType", [any, { value: "in-person", text: "in-person" }, { value: "video", text: "video" }], f.visitType)}
${select("In network for", "plan", [any, ...plans.map((pl) => ({ value: pl.code, text: `${pl.name} (${pl.code})` }))], f.plan)}
<label><input type="checkbox" name="newPatients" value="true" ${inline}${f.newPatients === "true" ? " checked" : ""}> Accepting new patients</label>
${field("Free appointment on (YYYY-MM-DD)", "date", f.date, 'placeholder="2027-04-12"')}<button>Find doctors</button></form>`;
}

export function home(p: string, clinics: Clinic[], plans: ClinicPlan[], f: FindParams = {}): string {
  return `<h1>Find a doctor</h1>${findForm(p, clinics, plans, f)}
<p class="muted">Appointments are 30 minutes, for dates in 2027, in person or by video. A doctor not accepting new patients sees only patients who already have an appointment with them. Sign in to book, cancel or request a refill.</p>
<h2>Cities</h2><ul>${[...new Set(clinics.map((c) => c.city))].sort().map((c) => `<li><a href="${p}/doctors?city=${encodeURIComponent(c)}">${esc(c)}</a></li>`).join("")}</ul>`;
}

export function doctorResults(p: string, f: FindParams, doctors: ClinicDoctorMatch[]): string {
  const day = f.date ? `date=${encodeURIComponent(f.date)}` : "";
  const rows = doctors
    .map(
      (d) => `<tr><td><a href="${p}/doctors/${esc(d.code)}${day ? `?${day}` : ""}">${esc(d.name)}</a> <code>${esc(d.code)}</code></td><td>${esc(d.specialty)}</td><td><a href="${p}/clinics/${esc(d.clinicCode)}">${esc(d.clinicName)}</a>, ${esc(d.city)}</td>
<td>${d.languages.map(tag).join(" ")}</td><td>${d.visitTypes.map(tag).join(" ")}</td><td>${d.acceptingNewPatients ? "yes" : "no"}</td><td>${d.networkPlans.map(tag).join(" ")}</td><td>${cents(d.inPersonFeeCents)} / ${cents(d.videoFeeCents)}</td>${f.date ? `<td>${(d.freeSlots ?? []).join(", ")}</td>` : ""}</tr>`,
    )
    .join("");
  const asked = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" · ");
  return `<h1>Doctors</h1><p class="muted">${doctors.length} doctor(s) fit ${esc(asked || "no filter")}. <a href="${p}/?${qs(f)}">Change the search</a></p>
<table><tr><th>Doctor</th><th>Specialty</th><th>Clinic</th><th>Languages</th><th>Visits</th><th>New patients</th><th>In network for</th><th>Fee in-person / video</th>${f.date ? `<th>Free on ${esc(f.date)}</th>` : ""}</tr>
${rows || `<tr><td colspan="${f.date ? 9 : 8}">No doctor fits every requirement.</td></tr>`}</table><p class="muted">The fee is what a visit costs a patient the doctor is not in network for; in network, the patient pays the plan's copay.</p>`;
}

export function clinicsList(p: string, clinics: Clinic[]): string {
  const rows = clinics.map((c) => `<tr><td><a href="${p}/clinics/${esc(c.code)}">${esc(c.name)}</a></td><td><code>${esc(c.code)}</code></td><td>${esc(c.city)}</td><td>${esc(c.address)}</td><td>${esc(c.phone)}</td><td>${esc(c.pharmacyPhone)}</td></tr>`).join("");
  return `<h1>Clinics</h1><p class="muted">Every clinic runs a pharmacy; a refill is collected at the pharmacy of the clinic it names.</p>
<table><tr><th>Clinic</th><th>Code</th><th>City</th><th>Address</th><th>Phone</th><th>Pharmacy phone</th></tr>${rows}</table>`;
}

export function clinicDetail(p: string, c: ClinicDetail): string {
  const rows = c.doctors.map((d) => `<tr><td><a href="${p}/doctors/${esc(d.code)}">${esc(d.name)}</a> <code>${esc(d.code)}</code></td><td>${esc(d.specialty)}</td><td>${d.acceptingNewPatients ? "yes" : "no"}</td></tr>`).join("");
  return `<h1>${esc(c.name)} <code>${esc(c.code)}</code></h1><p>${esc(c.address)} · phone ${esc(c.phone)} · pharmacy ${esc(c.pharmacyPhone)}</p>
<p><a href="${p}/medications">Prescription prices at every pharmacy</a></p><h2>Doctors</h2><table><tr><th>Doctor</th><th>Specialty</th><th>New patients</th></tr>${rows}</table>`;
}
