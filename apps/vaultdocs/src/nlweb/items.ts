import { digitalDocument, wordVariants, type AskItem } from "@benchme/site-kit";
import type { Doc, DocsRepo } from "../docs-repo.js";

/**
 * Every document in the vault as a DigitalDocument NLWeb item; kind and tags
 * feed `keywords` alongside their plural/singular variants.
 *
 * `prefix` is the caller's request-time `req.prefix`, NOT re-derived from
 * `ws` — see warehouse/src/nlweb/items.ts's doc comment for why.
 */
export async function vaultItems(repo: DocsRepo, ws: string, prefix: string): Promise<AskItem[]> {
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
