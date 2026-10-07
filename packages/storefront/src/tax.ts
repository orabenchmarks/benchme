import { applyBp } from "./money.js";

/** USPS ZIP3 ranges → state (inclusive). Military and territories are left out on purpose. */
const RANGES: [number, number, string][] = [
  [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"], [39, 49, "ME"], [50, 54, "VT"], [55, 55, "MA"], [56, 59, "VT"],
  [60, 69, "CT"], [70, 89, "NJ"], [100, 149, "NY"], [150, 196, "PA"], [197, 199, "DE"], [200, 200, "DC"],
  [201, 201, "VA"], [202, 205, "DC"], [206, 219, "MD"], [220, 246, "VA"], [247, 268, "WV"], [270, 289, "NC"],
  [290, 299, "SC"], [300, 319, "GA"], [320, 349, "FL"], [350, 369, "AL"], [370, 385, "TN"], [386, 397, "MS"],
  [398, 399, "GA"], [400, 427, "KY"], [430, 459, "OH"], [460, 479, "IN"], [480, 499, "MI"], [500, 528, "IA"],
  [530, 549, "WI"], [550, 567, "MN"], [570, 577, "SD"], [580, 588, "ND"], [590, 599, "MT"], [600, 629, "IL"],
  [630, 658, "MO"], [660, 679, "KS"], [680, 693, "NE"], [700, 714, "LA"], [716, 729, "AR"], [730, 749, "OK"],
  [750, 799, "TX"], [800, 816, "CO"], [820, 831, "WY"], [832, 838, "ID"], [840, 847, "UT"], [850, 865, "AZ"],
  [870, 884, "NM"], [885, 885, "TX"], [889, 898, "NV"], [900, 961, "CA"], [967, 968, "HI"], [970, 979, "OR"],
  [980, 994, "WA"], [995, 999, "AK"],
];

/** Statewide base rates in basis points (fictional stores: base rate only, no local add-ons). */
export const STATE_TAX_BP: Record<string, number> = {
  AL: 400, AK: 0, AZ: 560, AR: 650, CA: 725, CO: 290, CT: 635, DE: 0, DC: 600, FL: 600, GA: 400, HI: 400,
  ID: 600, IL: 625, IN: 700, IA: 600, KS: 650, KY: 600, LA: 445, ME: 550, MD: 600, MA: 625, MI: 600, MN: 688,
  MS: 700, MO: 423, MT: 0, NE: 550, NV: 685, NH: 0, NJ: 663, NM: 488, NY: 400, NC: 475, ND: 500, OH: 575,
  OK: 450, OR: 0, PA: 600, RI: 700, SC: 600, SD: 420, TN: 700, TX: 625, UT: 610, VT: 600, VA: 530, WA: 650,
  WV: 600, WI: 500, WY: 400,
};

const NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** Every state (and DC) with its name, sorted by code — the checkout's state select. */
export const US_STATES = Object.keys(STATE_TAX_BP).sort().map((code) => ({ code, name: NAMES[code] as string }));

/** A 5-digit ZIP from user input ("94107", " 94107-1234 "), or null. */
export function normalizeZip(raw: string): string | null {
  const m = /^\s*(\d{5})(?:-\d{4})?\s*$/.exec(raw);
  return m ? (m[1] as string) : null;
}

export function stateForZip(zip5: string): string | null {
  const p = Number(zip5.slice(0, 3));
  for (const [lo, hi, st] of RANGES) if (p >= lo && p <= hi) return st;
  return null;
}

export function zipMatchesState(zip5: string, state: string): boolean {
  return stateForZip(zip5) === state;
}

export function taxCents(taxable: number, state: string): number {
  return applyBp(taxable, STATE_TAX_BP[state] ?? 0);
}
