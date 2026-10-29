// Small regex-based RSS 2.0 / Atom parser. Deliberately not using an XML
// parsing library — feed structure is predictable enough that a handful of
// regexes cover the common cases without adding a dependency, matching how
// the rest of this app avoids libraries where plain code will do.

export interface FeedItem {
  title: string;
  link: string;
  summary: string;
  publishedAt: string | null; // ISO
}

function decodeEntities(str: string) {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function stripHtml(str: string) {
  return str.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function extractLink(block: string) {
  // RSS: <link>https://...</link>. Atom: <link href="https://..."/>.
  const plain = extractTag(block, "link");
  if (plain && !plain.includes("<")) return plain;
  const hrefMatch = block.match(/<link[^>]*\bhref="([^"]+)"/i);
  return hrefMatch ? hrefMatch[1] : plain;
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseFeed(xml: string): FeedItem[] {
  const blocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) ?? [];
  const items: FeedItem[] = [];

  for (const block of blocks) {
    const title = extractTag(block, "title");
    const link = extractLink(block);
    if (!title || !link) continue;

    const summaryRaw =
      extractTag(block, "description") || extractTag(block, "summary") || extractTag(block, "content");
    const summary = stripHtml(summaryRaw).slice(0, 240);
    const pubDateRaw =
      extractTag(block, "pubDate") || extractTag(block, "published") || extractTag(block, "updated");

    items.push({
      title,
      link,
      summary,
      publishedAt: parseDate(pubDateRaw),
    });
  }

  return items;
}

// AbortController timeout so one slow/dead feed can't hang the whole
// briefing — failures here just mean fewer articles, not a broken page.
export async function fetchFeed(url: string, timeoutMs = 8000): Promise<FeedItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LifeOS/1.0)" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseFeed(xml);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
