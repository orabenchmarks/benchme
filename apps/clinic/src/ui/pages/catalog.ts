import type { ClinicMedication, ClinicPlan, ClinicPriceOffer, ClinicProcedure } from "@benchme/scenarios";
import { esc, money } from "@benchme/site-kit";
import type { MedicationDetail, PlanDetail } from "../../db/catalog-repo.js";
import { field, inline } from "../shell.js";

const STATUS_TEXT = { covered: "covered", "prior-authorisation": "covered with prior authorisation", "not-covered": "not covered" } as const;

export function plansList(p: string, plans: ClinicPlan[], procedures: ClinicProcedure[]): string {
  const rows = plans.map((pl) => `<tr><td><a href="${p}/plans/${esc(pl.code)}">${esc(pl.name)}</a></td><td><code>${esc(pl.code)}</code></td><td>${money(pl.inPersonCopayCents)}</td><td>${money(pl.videoCopayCents)}</td></tr>`).join("");
  const procs = procedures.map((pr) => `<tr><td>${esc(pr.name)}</td><td><code>${esc(pr.code)}</code></td><td>${money(pr.priceCents)}</td></tr>`).join("");
  return `<h1>Insurance plans</h1><p class="muted">A plan's copay is what a visit costs a patient with a doctor in the plan's network; with a doctor out of network the patient pays the doctor's fee. Each plan's page lists its coverage of every procedure.</p>
<table><tr><th>Plan</th><th>Code</th><th>In-person copay</th><th>Video copay</th></tr>${rows}</table>
<h2>Procedures</h2><p class="muted">List prices, the same at every clinic.</p><table><tr><th>Procedure</th><th>Code</th><th>Price</th></tr>${procs}</table>`;
}

export function planDetail(p: string, plan: PlanDetail): string {
  const rows = plan.coverage
    .map((c) => `<tr><td>${esc(c.procedureName)} <code>${esc(c.procedureCode)}</code></td><td>${money(c.priceCents)}</td><td>${STATUS_TEXT[c.status]}</td><td>${c.coinsurancePct === null ? "—" : `${c.coinsurancePct}%`}</td><td>${money(c.patientCostCents)}</td></tr>`)
    .join("");
  return `<h1>${esc(plan.name)} <code>${esc(plan.code)}</code></h1><p>Copay with an in-network doctor: ${money(plan.inPersonCopayCents)} in person, ${money(plan.videoCopayCents)} by video. <a href="${p}/doctors?plan=${esc(plan.code)}">Doctors in network</a></p>
<h2>Coverage</h2><table><tr><th>Procedure</th><th>Price</th><th>Coverage</th><th>Coinsurance (the patient pays)</th><th>Patient pays</th></tr>${rows}</table>
<p class="muted">Covered: the patient pays the coinsurance share of the price. Covered with prior authorisation: the same share, once the plan has authorised the procedure. Not covered: the patient pays the whole price.</p>`;
}

export function medicationsList(p: string, meds: ClinicMedication[], f: { medication?: string | undefined; dosage?: string | undefined }, offers: ClinicPriceOffer[] | null): string {
  const rows = meds.map((m) => `<tr><td><a href="${p}/medications/${esc(m.code)}">${esc(m.name)}</a></td><td><code>${esc(m.code)}</code></td><td>${m.dosages.map(esc).join(", ")}</td></tr>`).join("");
  return `<h1>Prescription prices</h1><form method="get" action="${p}/medications">${field("Medication", "medication", f.medication, `placeholder="name or MED-…" ${inline}`)} ${field("Dosage", "dosage", f.dosage, `placeholder="20 mg" ${inline}`)} <button style="margin:0">Compare prices</button></form>
${offers ? priceTable(p, offers) : ""}<h2>Medications</h2><table><tr><th>Medication</th><th>Code</th><th>Dosages</th></tr>${rows}</table>`;
}

function priceTable(p: string, offers: ClinicPriceOffer[]): string {
  const rows = offers.map((o) => `<tr><td><a href="${p}/clinics/${esc(o.clinicCode)}">${esc(o.clinicName)}</a> <code>${esc(o.clinicCode)}</code></td><td>${esc(o.city)}</td><td>${esc(o.pharmacyPhone)}</td><td>${esc(o.medicationName)} ${esc(o.dosage)}</td><td>${money(o.priceCents)}</td></tr>`).join("");
  return `<p class="muted">Cheapest first. A pharmacy not listed does not stock it.</p><table><tr><th>Pharmacy</th><th>City</th><th>Phone</th><th>Medication</th><th>Price</th></tr>${rows || "<tr><td colspan=5>No pharmacy stocks it.</td></tr>"}</table>`;
}

export function medicationDetail(p: string, m: MedicationDetail): string {
  return `<h1>${esc(m.name)} <code>${esc(m.code)}</code></h1><p>Dosages: ${m.dosages.map(esc).join(", ")}</p>${priceTable(p, m.prices)}`;
}
