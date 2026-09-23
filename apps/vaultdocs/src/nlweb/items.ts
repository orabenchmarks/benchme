import { digitalDocument, type AskItem } from "@benchme/site-kit";
import type { Doc, DocsRepo } from "../docs-repo.js";

const APP = "vaultdocs";

/** Naive plural/singular pair — `tokenize` has no stemming (see warehouse/src/nlweb/items.ts for the same helper). */
function wordVariants(word: string): string[] {
  const w = word.toLowerCase();
  return w.endsWith("s") ? [w, w.slice(0, -1)] : [w, `${w}s`];
}

/** Every document in the vault as a DigitalDocument NLWeb item; kind and tags feed `keywords` alongside their plural/singular variants. */
export async function vaultItems(repo: DocsRepo, ws: string): Promise<AskItem[]> {
  const prefix = `/w/${ws}/${APP}`;
  const summaries = await repo.list(ws);
  const docs = await Promise.all(summaries.map((s) => repo.get(ws, s.id)));
  return docs.filter((d): d is Doc => d !== null).map((d) => {
    const url = `${prefix}/documents/${d.id}`;
    return {
      id: url,
      url,
      name: d.title,
      text: d.body,
      keywords: [...wordVariants(d.kind), ...d.tags.flatMap(wordVariants)],
      schema: digitalDocument({ id: url, url, name: d.title, text: d.body, keywords: d.tags, dateModified: d.updatedAt, additionalType: d.kind }),
    };
  });
}
