import type { ClinicPriceOffer } from "@benchme/scenarios";
import { esc, money } from "@benchme/site-kit";
import type { AppointmentRow } from "../../db/rows.js";
import type { PrescriptionDetail, PrescriptionRow } from "../../db/prescriptions-repo.js";
import { select, tag, visitText } from "../shell.js";

const emailForm = (action: string, f: Record<string, string | undefined>, extra = "") =>
  `<form method="get" action="${action}" style="margin-bottom:1rem"><input name="patientEmail" placeholder="patient email" value="${esc(f.patientEmail ?? "")}" style="width:16rem;display:inline">${extra} <button style="margin:0">Find</button></form>`;

export function appointmentsList(p: string, items: AppointmentRow[], nextCursor: string | null, f: Record<string, string | undefined>): string {
  const rows = items
    .map((a) => `<tr><td><a href="${p}/appointments/${esc(a.appointmentNo)}">${esc(a.appointmentNo)}</a></td><td>${esc(a.patientName)}<br><span class="muted">${esc(a.patientEmail)}</span></td><td><a href="${p}/doctors/${esc(a.doctorCode)}">${esc(a.doctorCode)}</a></td><td>${esc(a.date)} ${esc(a.time)}</td><td>${visitText(a.visitType)}</td><td>${tag(a.status)}</td></tr>`)
    .join("");
  const keep = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(String(v))}`).join("");
  const next = nextCursor ? `<nav class="pager"><a href="${p}/appointments?cursor=${esc(nextCursor)}${keep}">Next page →</a></nav>` : "";
  const doctor = ` <input name="doctor" placeholder="doctor code" value="${esc(f.doctor ?? "")}" style="width:8rem;display:inline"> <input name="date" placeholder="date" value="${esc(f.date ?? "")}" style="width:8rem;display:inline">`;
  return `<h1>Appointments</h1>${emailForm(`${p}/appointments`, f, doctor)}
<table><tr><th>No</th><th>Patient</th><th>Doctor</th><th>When</th><th>Visit</th><th>Status</th></tr>${rows || "<tr><td colspan=6>None.</td></tr>"}</table>${next}`;
}

export function appointmentDetail(p: string, a: AppointmentRow, doctorName: string, canWrite: boolean): string {
  const cancel = a.status === "booked" ? (canWrite ? `<form class="card" method="post" action="${p}/appointments/${esc(a.appointmentNo)}/cancel"><button>Cancel this appointment</button></form>` : `<p class="muted">Sign in to cancel.</p>`) : "";
  return `<h1>Appointment ${esc(a.appointmentNo)}</h1><p>${tag(a.status)} · <a href="${p}/doctors/${esc(a.doctorCode)}">${esc(doctorName)}</a> · <a href="${p}/clinics/${esc(a.clinicCode)}">${esc(a.clinicCode)}</a></p>
<table><tr><th>Patient</th><td>${esc(a.patientName)} (${esc(a.patientEmail)})</td></tr><tr><th>When</th><td>${esc(a.date)} at ${esc(a.time)}, 30 minutes</td></tr>
<tr><th>Visit</th><td>${visitText(a.visitType)}</td></tr><tr><th>Plan</th><td>${a.planCode ? esc(a.planCode) : "none"}</td></tr><tr><th>Patient pays</th><td>${money(a.costCents)}</td></tr></table>${cancel}`;
}

export function prescriptionsList(p: string, items: PrescriptionRow[], f: Record<string, string | undefined>): string {
  const rows = items
    .map((r) => `<tr><td><a href="${p}/prescriptions/${esc(r.rxNo)}">${esc(r.rxNo)}</a></td><td>${esc(r.patientName)}<br><span class="muted">${esc(r.patientEmail)}</span></td><td>${esc(r.medicationName)} ${esc(r.dosage)}</td><td>${esc(r.issuedOn)}</td><td>${r.refillsLeft}</td><td>${r.refillPending ? "requested" : "—"}</td></tr>`)
    .join("");
  return `<h1>Prescriptions</h1>${emailForm(`${p}/prescriptions`, f)}
<table><tr><th>No</th><th>Patient</th><th>Medication</th><th>Issued</th><th>Refills left</th><th>Refill</th></tr>${rows || "<tr><td colspan=6>None.</td></tr>"}</table>`;
}

export function prescriptionDetail(p: string, rx: PrescriptionDetail, offers: ClinicPriceOffer[], canWrite: boolean): string {
  const history = rx.refills.map((r) => `<tr><td>${esc(r.refillNo)}</td><td><a href="${p}/clinics/${esc(r.pharmacyCode)}">${esc(r.pharmacyCode)}</a></td><td>${tag(r.status)}</td><td>${esc(r.requestedAt.slice(0, 10))}</td></tr>`).join("");
  const options = offers.map((o) => ({ value: o.clinicCode, text: `${o.clinicName} (${o.clinicCode}), ${o.city} — ${money(o.priceCents)}` }));
  const form = !canWrite
    ? `<p class="muted">Sign in to request a refill.</p>`
    : options.length
      ? `<h2>Request a refill</h2><form class="card" method="post" action="${p}/prescriptions/${esc(rx.rxNo)}/refill">${select("Collect at the pharmacy of", "pharmacyCode", options, undefined)}<button>Request refill</button></form>`
      : `<p class="muted">No pharmacy stocks ${esc(rx.medicationName)} ${esc(rx.dosage)}.</p>`;
  return `<h1>Prescription ${esc(rx.rxNo)}</h1><p>${esc(rx.medicationName)} <code>${esc(rx.medicationCode)}</code> ${esc(rx.dosage)} · prescribed by <a href="${p}/doctors/${esc(rx.doctorCode)}">${esc(rx.doctorCode)}</a> on ${esc(rx.issuedOn)}</p>
<table><tr><th>Patient</th><td>${esc(rx.patientName)} (${esc(rx.patientEmail)})</td></tr><tr><th>Refills left</th><td>${rx.refillsLeft}</td></tr><tr><th>Refill requested</th><td>${rx.refillPending ? "yes, waiting to be collected" : "no"}</td></tr></table>
<h2>Refills</h2><table><tr><th>No</th><th>Pharmacy</th><th>Status</th><th>Requested</th></tr>${history || "<tr><td colspan=4>None yet.</td></tr>"}</table>
<p class="muted">Pharmacies stocking ${esc(rx.medicationName)} ${esc(rx.dosage)}, cheapest first, are listed in the form.</p>${form}`;
}
