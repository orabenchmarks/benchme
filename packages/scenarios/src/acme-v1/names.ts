import { type Rng, int, pick } from "../prng.js";

/**
 * Invented vocabulary. Product and company names are built from syllables so
 * nothing here matches a real brand, place or dataset an agent could recall.
 */
const SYLLABLES = ["ka", "lo", "ren", "vi", "tho", "mar", "el", "quen", "dor", "sil", "ba", "nex", "tru", "om", "fal", "zy"];
const CATEGORIES = ["fasteners", "optics", "cabling", "enclosures", "sensors", "tooling", "adhesives", "fluidics"] as const;
const CITIES = ["Velmora", "Ostrand", "Quillhaven", "Brenmoor", "Tessalind", "Karrow"] as const;
const FIRST = ["Ilsa", "Bram", "Teodor", "Maren", "Quill", "Sable", "Orrin", "Vesna", "Lior", "Danae"] as const;
const LAST = ["Halvard", "Okonjo", "Prewitt", "Sandoval", "Thorsby", "Mbeki", "Larrabee", "Voss", "Ferrante", "Kowalczyk"] as const;

export function word(rng: Rng, syllables = int(rng, 2, 3)): string {
  let s = "";
  for (let i = 0; i < syllables; i++) s += pick(rng, SYLLABLES);
  return s[0]!.toUpperCase() + s.slice(1);
}

export function category(rng: Rng): string {
  return pick(rng, CATEGORIES);
}

export function city(rng: Rng): string {
  return pick(rng, CITIES);
}

export function personName(rng: Rng): string {
  return `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
}

export function companyName(rng: Rng): string {
  return `${word(rng)} ${pick(rng, ["Industrial", "Supply", "Systems", "Works", "Logistics"])}`;
}

export const CATEGORY_LIST: readonly string[] = CATEGORIES;
