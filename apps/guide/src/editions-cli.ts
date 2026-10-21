import { corpusEntry } from "./editions/corpus.js";
import { defaultEditionTable } from "./editions/resolver.js";

/** Prints the edition corpus (every edition's prompt inputs) as JSON: `npm run editions -w @benchme/guide`. */
process.stdout.write(`${JSON.stringify({ scenario: "guide-v1", editions: defaultEditionTable().all().map(corpusEntry) }, null, 2)}\n`);
