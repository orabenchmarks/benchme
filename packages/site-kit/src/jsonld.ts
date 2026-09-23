/**
 * schema.org JSON-LD builders. Every site emits its items through these so the
 * shapes a crawler sees are identical across sites — a benchmark comparing an
 * agent on two sites must not be measuring two different JSON-LD dialects.
 * Each builder returns a plain object with @context/@type/@id/url; optional
 * fields are OMITTED rather than emitted as null (a null trips strict parsers).
 */

export const SCHEMA_CONTEXT = "https://schema.org";

type Json = Record<string, unknown>;

/** Drop undefined so an absent field never reaches the wire. */
function compact(o: Json): Json {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

function base(type: string, id: string, url: string, name?: string): Json {
  return compact({ "@context": SCHEMA_CONTEXT, "@type": type, "@id": id, url, name });
}

export type Availability = "in_stock" | "out_of_stock";

export function product(p: {
  id: string;
  url: string;
  name: string;
  sku?: string;
  category?: string;
  description?: string;
  priceCents: number;
  currency?: string;
  availability: Availability;
}): Json {
  return compact({
    ...base("Product", p.id, p.url, p.name),
    sku: p.sku,
    category: p.category,
    description: p.description,
    offers: offer({ priceCents: p.priceCents, ...(p.currency ? { currency: p.currency } : {}), availability: p.availability, url: p.url }),
  });
}

/** Standalone so a listing can carry several offers for one item. */
export function offer(o: { priceCents: number; currency?: string; availability: Availability; url?: string }): Json {
  return compact({
    "@type": "Offer",
    url: o.url,
    price: (o.priceCents / 100).toFixed(2),
    priceCurrency: o.currency ?? "USD",
    availability: o.availability === "in_stock" ? `${SCHEMA_CONTEXT}/InStock` : `${SCHEMA_CONTEXT}/OutOfStock`,
  });
}

export function place(p: { id: string; url: string; name: string; addressLocality?: string; addressRegion?: string; addressCountry?: string }): Json {
  const address = compact({
    "@type": "PostalAddress",
    addressLocality: p.addressLocality,
    addressRegion: p.addressRegion,
    addressCountry: p.addressCountry,
  });
  // Only carries "@type" when every address part was absent — emit no address at all rather than an empty one.
  const hasAddress = Object.keys(address).length > 1;
  return compact({ ...base("Place", p.id, p.url, p.name), address: hasAddress ? address : undefined });
}

export function organization(o: {
  id: string;
  url: string;
  name: string;
  description?: string;
  foundingDate?: string;
  numberOfEmployees?: number;
  address?: Json;
}): Json {
  return compact({
    ...base("Organization", o.id, o.url, o.name),
    description: o.description,
    foundingDate: o.foundingDate,
    numberOfEmployees: o.numberOfEmployees,
    address: o.address,
  });
}

export function person(p: { id: string; url: string; name: string; jobTitle?: string; email?: string; worksFor?: Json }): Json {
  return compact({ ...base("Person", p.id, p.url, p.name), jobTitle: p.jobTitle, email: p.email, worksFor: p.worksFor });
}

export function comment(c: { id: string; url?: string; text: string; dateCreated: string; author?: string }): Json {
  return compact({
    "@type": "Comment",
    "@id": c.id,
    url: c.url,
    text: c.text,
    dateCreated: c.dateCreated,
    author: c.author ? { "@type": "Person", name: c.author } : undefined,
  });
}

/** A help-desk ticket or forum thread: the resolution becomes `acceptedAnswer`, which is what an agent looks for. */
export function question(q: {
  id: string;
  url: string;
  name: string;
  text: string;
  dateCreated: string;
  author?: string;
  answer?: { text: string; dateCreated: string; author?: string };
  comments?: Json[];
}): Json {
  return compact({
    ...base("Question", q.id, q.url, q.name),
    text: q.text,
    dateCreated: q.dateCreated,
    author: q.author ? { "@type": "Person", name: q.author } : undefined,
    acceptedAnswer: q.answer
      ? compact({
          "@type": "Answer",
          text: q.answer.text,
          dateCreated: q.answer.dateCreated,
          author: q.answer.author ? { "@type": "Person", name: q.answer.author } : undefined,
        })
      : undefined,
    comment: q.comments && q.comments.length > 0 ? q.comments : undefined,
  });
}

export function digitalDocument(d: {
  id: string;
  url: string;
  name: string;
  text?: string;
  keywords?: string[];
  dateModified?: string;
  additionalType?: string;
}): Json {
  return compact({
    ...base("DigitalDocument", d.id, d.url, d.name),
    text: d.text,
    keywords: d.keywords && d.keywords.length > 0 ? d.keywords.join(", ") : undefined,
    dateModified: d.dateModified,
    additionalType: d.additionalType,
  });
}

export function webPage(p: { id: string; url: string; name: string; description?: string }): Json {
  return compact({ ...base("WebPage", p.id, p.url, p.name), description: p.description });
}
