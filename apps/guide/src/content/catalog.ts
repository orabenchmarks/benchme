import { ebike } from "./categories/ebike.js";
import { espresso } from "./categories/espresso.js";
import { passwords } from "./categories/passwords.js";
import { pm } from "./categories/pm.js";
import type { Category } from "./types.js";

/** Every category the guide publishes. A new category is a new file in categories/ registered here, plus edition-table rows. */
export const CATEGORIES: readonly Category[] = [pm, passwords, espresso, ebike];
