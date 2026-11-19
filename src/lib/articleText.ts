import { decodeEntities } from "@/lib/rss";

// Fetches a news article and pulls out its body text, so Claude can write
// the Daily Briefing paper from the story itself rather than a one-line
// feed blurb. Deliberately simple (the text of <p> tags, no readability
// library): paywalled or script-rendered pages just return null, and the
// paper falls back to the headline and blurb for that story.

const MAX_WORDS = 1200;
const MIN_WORDS = 80;

export async function fetchArticleText(url: string, timeoutMs = 8000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)",
        Accept: "text/html",
      },
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const html = (await res.text())
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ");

    const paragraphs = (html.match(/<p[\s>][\s\S]*?<\/p>/gi) ?? [])
      .map((p) => decodeEntities(p.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
      // Short <p>s are bylines, captions, "Advertisement", newsletter plugs.
      .filter((p) => p.split(" ").length >= 12);

    const words = paragraphs.join("\n\n").split(" ");
    if (words.length < MIN_WORDS) return null;
    return words.slice(0, MAX_WORDS).join(" ");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
