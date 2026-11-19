import { registerAuthRoutes, type AuthService, type ToolRegistry } from "@benchme/site-kit";
import type { FastifyInstance } from "fastify";
import type { AppointmentsRepo } from "../db/appointments-repo.js";
import type { CatalogRepo } from "../db/catalog-repo.js";
import type { PrescriptionsRepo } from "../db/prescriptions-repo.js";
import type { ToolContext } from "../mcp/tools.js";
import { registerCatalogUi } from "./catalog-routes.js";
import { registerPatientUi } from "./patient-routes.js";
import { SESSION_COOKIE, shellCtx } from "./shell.js";

export type UiDeps = { catalog: CatalogRepo; appointments: AppointmentsRepo; prescriptions: PrescriptionsRepo; auth: AuthService; tools: ToolRegistry<ToolContext> };

/** The pages: site-kit's auth pages, then the catalog (find, doctor, book) and the patient's own rows (cancel, refill). */
export function registerUi(app: FastifyInstance, d: UiDeps): void {
  const ctx = shellCtx(d.auth, d.tools);
  registerAuthRoutes(app, { auth: d.auth, cookie: SESSION_COOKIE, shellCtx: ctx });
  registerCatalogUi(app, { catalog: d.catalog, appointments: d.appointments, auth: d.auth, ctx });
  registerPatientUi(app, { catalog: d.catalog, appointments: d.appointments, prescriptions: d.prescriptions, auth: d.auth, ctx });
}
