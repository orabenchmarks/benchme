import { registerAuthRoutes } from "@benchme/site-kit";
import type { FastifyInstance } from "fastify";
import { registerBrowseUi } from "./browse-routes.js";
import { registerEventUi } from "./event-routes.js";
import { registerRegistrationUi } from "./registration-routes.js";
import { uiKit, type UiDeps } from "./shell.js";

export { SESSION_COOKIE, type UiDeps } from "./shell.js";

/** The site's pages: sign-up and sign-in, then browsing, events and registrations, each in its own module. */
export function registerUi(app: FastifyInstance, d: UiDeps): void {
  const { kit, authDeps } = uiKit(d);
  registerAuthRoutes(app, authDeps);
  registerBrowseUi(app, kit);
  registerEventUi(app, kit);
  registerRegistrationUi(app, kit);
}
