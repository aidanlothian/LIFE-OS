import { createClient } from "@/lib/supabase/server";
import { fetchFeed, type FeedItem } from "@/lib/rss";

// Starter sources, one or more per topic. These are just a starting point:
// sources can be added or removed per account, and keyword weighting
// (below) does the "care more about what I follow" work without needing a
// separate per-source score.
//
// Non-sports is deliberately split into 4 topics (US Politics, World,
// Business, Climate) against sports' 3 (NBA/MLB/NFL) — selectBalanced
// guarantees each *topic* an equal minimum share, so more non-sports
// topics is what actually shifts the guaranteed slot split away from
// sports, rather than just adding more sports-adjacent volume.
const DEFAULT_SOURCES: { label: string; feed_url: string; topic: string }[] = [
  { label: "ESPN NBA", feed_url: "https://www.espn.com/espn/rss/nba/news", topic: "NBA" },
  { label: "ESPN MLB", feed_url: "https://www.espn.com/espn/rss/mlb/news", topic: "MLB" },
  { label: "ESPN NFL", feed_url: "https://www.espn.com/espn/rss/nfl/news", topic: "NFL" },
  { label: "NPR Politics", feed_url: "https://feeds.npr.org/1014/rss.xml", topic: "US Politics" },
  { label: "The Hill", feed_url: "https://thehill.com/rss/syndicator/19110", topic: "US Politics" },
  {
    label: "BBC World News",
    feed_url: "http://feeds.bbci.co.uk/news/world/rss.xml",
    topic: "World",
  },
  {
    label: "Dow Jones World News",
    feed_url: "https://feeds.content.dowjones.io/public/rss/RSSWorldNews",
    topic: "World",
  },
  {
    label: "CNBC Business",
    feed_url: "https://www.cnbc.com/id/10001147/device/rss/rss.html",
    topic: "Business",
  },
  { label: "WSJ Markets", feed_url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", topic: "Business" },
  { label: "Grist (Climate)", feed_url: "https://grist.org/feed/", topic: "Climate" },
];

// Initial bias: general league news low, M&A/PE terms elevated for
// business/consulting relevance, climate terms elevated. Feedback adjusts
// all of this from here — these are just a starting point, not fixed.
const DEFAULT_KEYWORD_SCORES: Record<string, number> = {
  // Add favourite teams here with a higher score (e.g. "red sox": 4);
  // multi-word names score as a phrase, see extractKeywords.
  nba: 1,
  mlb: 1,
  nfl: 1,
  // US politics — bumped up from the original baseline of 1, plus the
  // specific institutions/events that tend to mark an actually significant
  // story rather than routine coverage.
  politics: 2,
  election: 2,
  congress: 2,
  senate: 2,
  "white house": 2,
  "supreme court": 2,
  president: 1,
  // Global/world politics — new topic, so these terms are what let its
  // biggest stories outrank routine sports coverage in the score-based
  // fill (selectBalanced's leftover slots), not just its guaranteed share.
  world: 1,
  global: 1,
  war: 2,
  conflict: 2,
  "united nations": 2,
  nato: 2,
  invasion: 2,
  // Business — existing M&A/PE terms kept high (consulting/finance
  // relevance), plus market-mover terms that mark genuinely important
  // headlines rather than routine market chatter.
  merger: 3,
  mergers: 3,
  acquisition: 3,
  acquisitions: 3,
  "private equity": 3,
  "m&a": 3,
  buyout: 2,
  earnings: 2,
  ipo: 2,
  "interest rates": 2,
  inflation: 2,
  "federal reserve": 2,
  fed: 1,
  climate: 2,
  environment: 1,
  sustainability: 1,
  emissions: 2,
};

// Upsert-based rather than a "does the user have any rows at all" check —
// same reasoning as ensureDefaultHabits: it means a source/keyword added
// to the DEFAULT_* lists later (like the US Politics/World expansion)
// actually reaches existing users on their next load, rather than only
// ever applying to a brand-new account. ignoreDuplicates leaves a source
// or a feedback-adjusted keyword score already on the account untouched.
export async function ensureDefaultNewsSources(userId: string) {
  const supabase = createClient();
  const { error } = await supabase.from("news_sources").upsert(
    DEFAULT_SOURCES.map((s) => ({ ...s, user_id: userId })),
    { onConflict: "user_id,feed_url", ignoreDuplicates: true }
  );
  if (error) console.error("ensureDefaultNewsSources upsert error:", error);
}

export async function ensureDefaultKeywordScores(userId: string) {
  const supabase = createClient();
  const { error } = await supabase.from("news_keyword_scores").upsert(
    Object.entries(DEFAULT_KEYWORD_SCORES).map(([keyword, score]) => ({
      user_id: userId,
      keyword,
      score,
    })),
    { onConflict: "user_id,keyword", ignoreDuplicates: true }
  );
  if (error) console.error("ensureDefaultKeywordScores upsert error:", error);
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is",
  "are", "as", "at", "by", "from", "this", "that", "it", "after", "before",
  "new", "says", "say", "report", "reports", "over", "into", "amid", "than",
  "his", "her", "their", "its", "how", "what", "who", "why", "will", "was",
  "were", "has", "have", "had", "not", "but", "out", "up", "down", "off",
]);

// Unigrams and adjacent-word bigrams (so "red sox" scores as its own
// phrase, not just "red" + "sox" separately) — see DEFAULT_KEYWORD_SCORES
// for why the bigram form matters for team names and terms like "m&a".
export function extractKeywords(title: string): string[] {
  const words = title
    .replace(/[^\w\s&'-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  const unigrams = new Set(words);
  const bigrams = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i]} ${words[i + 1]}`);
  }

  return Array.from(new Set([...unigrams, ...bigrams]));
}

// Jaccard word-overlap over titles — good enough to catch the same
// underlying story covered by multiple outlets/sources without needing
// anything heavier (embeddings, an LLM call) for what's still a small
// daily batch of headlines.
function titleWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

const DUPLICATE_THRESHOLD = 0.5;

// Drops near-duplicate titles (the same story picked up by more than one
// source), keeping whichever copy sorts first — callers pass items
// pre-sorted by score descending so the higher-scored copy survives.
function dedupeByTitle<T extends { title: string }>(items: T[]): T[] {
  const kept: T[] = [];
  const signatures: Set<string>[] = [];
  for (const item of items) {
    const sig = titleWords(item.title);
    const isDuplicate = signatures.some((s) => jaccard(sig, s) >= DUPLICATE_THRESHOLD);
    if (!isDuplicate) {
      kept.push(item);
      signatures.push(sig);
    }
  }
  return kept;
}

// Guarantees every represented topic gets a fair minimum share of the
// display slots (so 6 sports sources across 3 topics can't crowd out
// Politics/Business/Climate just by having more raw volume), then fills
// any leftover slots by best score regardless of topic.
function selectBalanced<T extends { topic: string; score: number; id: string }>(
  items: T[],
  displayCount: number
): T[] {
  const topics = Array.from(new Set(items.map((a) => a.topic)));
  if (topics.length === 0) return [];
  const perTopicTarget = Math.max(1, Math.floor(displayCount / topics.length));

  const selected: T[] = [];
  const selectedIds = new Set<string>();

  for (const topic of topics) {
    const pool = items.filter((a) => a.topic === topic).sort((a, b) => b.score - a.score);
    for (const a of pool.slice(0, perTopicTarget)) {
      selected.push(a);
      selectedIds.add(a.id);
    }
  }

  if (selected.length < displayCount) {
    const remaining = items.filter((a) => !selectedIds.has(a.id)).sort((a, b) => b.score - a.score);
    for (const a of remaining) {
      if (selected.length >= displayCount) break;
      selected.push(a);
      selectedIds.add(a.id);
    }
  }

  return selected.sort((a, b) => b.score - a.score).slice(0, displayCount);
}

export interface BriefingArticle {
  id: string;
  title: string;
  link: string;
  summary: string | null;
  publishedAt: string | null;
  sourceLabel: string;
  topic: string;
  score: number;
  reaction: "like" | "dislike" | null;
}

const MAX_PER_SOURCE = 15;
const DISPLAY_COUNT = 12;

// Returns today's briefing, fetching+scoring+caching on the first call of
// the day and just reading the cache on every call after that.
export async function getTodaysBriefing(userId: string, dateStr: string): Promise<BriefingArticle[]> {
  const supabase = createClient();

  const { data: cached, error: cachedError } = await supabase
    .from("news_articles")
    .select("id, title, link, summary, published_at, score, source_id")
    .eq("fetched_for_date", dateStr)
    .order("score", { ascending: false });
  if (cachedError) console.error("getTodaysBriefing cached error:", cachedError);

  let articles = cached ?? [];

  if (articles.length === 0) {
    const { data: sources, error: sourcesError } = await supabase
      .from("news_sources")
      .select("id, label, feed_url, topic")
      .eq("active", true);
    if (sourcesError) console.error("getTodaysBriefing sources error:", sourcesError);

    if (sources && sources.length > 0) {
      const { data: keywordRows } = await supabase
        .from("news_keyword_scores")
        .select("keyword, score");
      const keywordScores = new Map((keywordRows ?? []).map((r) => [r.keyword, r.score as number]));

      const perSource = await Promise.all(
        sources.map(async (source) => {
          const items = await fetchFeed(source.feed_url);
          return items.slice(0, MAX_PER_SOURCE).map((item: FeedItem) => {
            const keywords = extractKeywords(item.title);
            const score = keywords.reduce((sum, k) => sum + (keywordScores.get(k) ?? 0), 0);
            return {
              user_id: userId,
              source_id: source.id,
              title: item.title,
              link: item.link,
              summary: item.summary || null,
              published_at: item.publishedAt,
              fetched_for_date: dateStr,
              score,
            };
          });
        })
      );

      // Highest-scored copy of a duplicated story survives the dedup pass.
      const rows = dedupeByTitle(perSource.flat().sort((a, b) => b.score - a.score));

      if (rows.length > 0) {
        // ignoreDuplicates guards the same race-on-first-load-of-the-day
        // pattern used elsewhere (habits, templates) — two tabs loading
        // simultaneously on a fresh day can't create duplicate articles.
        const { error: upsertError } = await supabase
          .from("news_articles")
          .upsert(rows, { onConflict: "user_id,link,fetched_for_date", ignoreDuplicates: true });
        if (upsertError) console.error("getTodaysBriefing upsert error:", upsertError);
      }

      const { data: fresh, error: freshError } = await supabase
        .from("news_articles")
        .select("id, title, link, summary, published_at, score, source_id")
        .eq("fetched_for_date", dateStr)
        .order("score", { ascending: false });
      if (freshError) console.error("getTodaysBriefing fresh error:", freshError);
      articles = fresh ?? [];
    }
  }

  if (articles.length === 0) return [];

  const { data: sources } = await supabase.from("news_sources").select("id, label, topic");
  const sourceMap = new Map((sources ?? []).map((s) => [s.id, s]));

  const withTopic = articles.map((a) => ({
    ...a,
    topic: sourceMap.get(a.source_id as string)?.topic ?? "General",
  }));
  const topArticles = selectBalanced(withTopic, DISPLAY_COUNT);
  if (topArticles.length === 0) return [];

  const { data: feedback } = await supabase
    .from("news_feedback")
    .select("article_id, reaction")
    .in(
      "article_id",
      topArticles.map((a) => a.id)
    );
  const reactionMap = new Map((feedback ?? []).map((f) => [f.article_id, f.reaction as "like" | "dislike"]));

  return topArticles.map((a) => {
    const source = sourceMap.get(a.source_id as string);
    return {
      id: a.id,
      title: a.title,
      link: a.link,
      summary: a.summary,
      publishedAt: a.published_at,
      sourceLabel: source?.label ?? "Unknown source",
      topic: a.topic,
      score: a.score,
      reaction: reactionMap.get(a.id) ?? null,
    };
  });
}
