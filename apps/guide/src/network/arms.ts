import type { PointerKey } from "./pointers.js";

/**
 * The network study's ARMS, as data (Registry, never a switch). Every arm serves the same start page and the same
 * four vendor sites; they differ in how many recommendation sites they serve (`n`) and in how a run is meant to
 * reach them (`entry`):
 * - `vendor` — the target's own vendor site points to the chain's first site and each site points to the next, in
 *   the arm's pointer style: a CHAIN the run reaches only by following pointers;
 * - `task` — nothing points into the network; the task names the n sites (EXPLICIT). Their pages are the editorial
 *   chain's of the same n, so an explicit arm and its editorial chain differ only in how a run arrives;
 * - `none` — no recommendation site is served (BASE).
 */
export const NS = [1, 2, 4, 8] as const;
export type N = (typeof NS)[number];
export type Family = "base" | "chain-e" | "chain-a" | "explicit";
export type NetworkArmKey = "base" | `${Exclude<Family, "base">}-${N}`;

export type NetworkArm = {
  readonly key: NetworkArmKey;
  readonly label: string;
  readonly family: Family;
  readonly n: 0 | N;
  readonly entry: "none" | "vendor" | "task";
  /** The pointer style its pages use between sites (and, for a chain, on the target's vendor site). */
  readonly pointer: PointerKey | null;
};

type FamilyShape = Pick<NetworkArm, "entry" | "pointer"> & { readonly label: string };

/** Each family's shape: where a run enters the network and how its pages point onward. */
const FAMILIES: Readonly<Record<Exclude<Family, "base">, FamilyShape>> = {
  "chain-e": { label: "Chain (links)", entry: "vendor", pointer: "editorial" },
  "chain-a": { label: "Chain (to agents)", entry: "vendor", pointer: "agent" },
  explicit: { label: "Explicit", entry: "task", pointer: "editorial" },
};

const BASE: NetworkArm = { key: "base", label: "Base", family: "base", n: 0, entry: "none", pointer: null };

export const NETWORK_ARMS: Readonly<Record<string, NetworkArm>> = Object.fromEntries([
  ["base", BASE],
  ...(Object.entries(FAMILIES) as [Exclude<Family, "base">, FamilyShape][]).flatMap(([family, shape]) =>
    NS.map((n): [string, NetworkArm] => {
      const key = `${family}-${n}` as NetworkArmKey;
      return [key, { key, label: `${shape.label} ${n}`, family, n, entry: shape.entry, pointer: shape.pointer }];
    }),
  ),
]);

export const NETWORK_ARM_KEYS = Object.keys(NETWORK_ARMS) as NetworkArmKey[];
