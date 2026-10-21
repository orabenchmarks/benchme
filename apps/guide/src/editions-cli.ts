import { corpusEntry } from "./editions/corpus.js";
import { GUIDE_SCENARIO } from "./editions/editions.js";
import { defaultEditionTable } from "./editions/resolver.js";
import { networkCorpusEntry } from "./network/corpus.js";
import { NETWORK_SCENARIO } from "./network/editions.js";
import { defaultNetworkTable } from "./network/table.js";

/**
 * Prints an edition corpus (every edition's prompt inputs) as JSON — the guide's by default, the site network's with
 * `--scenario web-v1`: `npm run editions -w @benchme/guide [-- --scenario web-v1]`.
 */
const at = process.argv.indexOf("--scenario");
const scenario = at > 0 ? process.argv[at + 1] : GUIDE_SCENARIO;
if (scenario !== GUIDE_SCENARIO && scenario !== NETWORK_SCENARIO) {
  process.stderr.write(`unknown scenario "${scenario}" (${GUIDE_SCENARIO} | ${NETWORK_SCENARIO})\n`);
  process.exit(2);
}
const corpus =
  scenario === NETWORK_SCENARIO
    ? { scenario, editions: defaultNetworkTable().all().map(networkCorpusEntry) }
    : { scenario, editions: defaultEditionTable().all().map(corpusEntry) };
process.stdout.write(`${JSON.stringify(corpus, null, 2)}\n`);
