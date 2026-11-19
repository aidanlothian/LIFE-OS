import { createClient } from "@/lib/supabase/server";
import { getTodaysBriefing } from "@/lib/news";
import { fetchArticleText } from "@/lib/articleText";
import { writeEdition, type WrittenStory } from "@/lib/newsAi";

// The Daily Briefing as a written paper: one edition per app-day, stored in
// news_editions. Home starts the writing on the first load of the day (it
// takes a minute or so) and shows the plain link list until it's ready.

export interface EditionArticle {
  id: string;
  title: string;
  link: string;
  source: string;
}

export interface EditionStory {
  headline: string;
  paragraphs: string[];
  articles: EditionArticle[];
}

export interface Edition {
  summary: string[];
  lead: EditionStory;
  sections: { name: string; stories: EditionStory[] }[];
}

export interface EditionRow {
  status: "writing" | "ready" | "failed";
  content: Edition | null;
  error: string | null;
  startedAt: string;
}

// Candidates Claude chooses from, and how many of those get their full
// article text fetched (the rest go in as headline + blurb).
const CANDIDATES = 24;
const WITH_TEXT = 16;
// A "writing" row older than this is treated as abandoned (the request
// that started it died), so a new load may take over.
export const STALE_WRITING_MS = 6 * 60 * 1000;

export async function getEdition(dateStr: string): Promise<EditionRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("news_editions")
    .select("status, content, error, started_at")
    .eq("edition_date", dateStr)
    .maybeSingle();
  // Before news_editions exists this errors; the briefing just stays a list.
  if (error) {
    console.error("getEdition error:", error);
    return null;
  }
  if (!data) return null;
  return {
    status: data.status,
    content: data.content as Edition | null,
    error: data.error,
    startedAt: data.started_at,
  };
}

// Writes today's paper unless it's already written or being written.
// Returns once it's saved (or failed). Never throws.
export async function ensureEdition(userId: string, dateStr: string): Promise<void> {
  const supabase = createClient();

  // Claim the day. The unique (user_id, edition_date) index means only one
  // request wins the insert; a loser may still take over a failed or
  // abandoned attempt.
  const { error: claimError } = await supabase
    .from("news_editions")
    .insert({ user_id: userId, edition_date: dateStr, status: "writing" });
  if (claimError) {
    const existing = await getEdition(dateStr);
    if (!existing || existing.status === "ready") return;
    const abandoned =
      existing.status === "writing" && Date.now() - new Date(existing.startedAt).getTime() > STALE_WRITING_MS;
    if (existing.status === "writing" && !abandoned) return;
    const { error: retakeError } = await supabase
      .from("news_editions")
      .update({ status: "writing", error: null, started_at: new Date().toISOString() })
      .eq("edition_date", dateStr);
    if (retakeError) {
      console.error("ensureEdition retake error:", retakeError);
      return;
    }
  }

  try {
    const articles = await getTodaysBriefing(userId, dateStr, CANDIDATES);
    if (articles.length === 0) throw new Error("No stories from your sources yet today.");

    const texts = await Promise.all(
      articles.map((a, i) => (i < WITH_TEXT ? fetchArticleText(a.link) : Promise.resolve(null)))
    );

    const { data: liked } = await supabase
      .from("news_keyword_scores")
      .select("keyword")
      .gt("score", 0)
      .order("score", { ascending: false })
      .limit(20);

    const written = await writeEdition(
      articles.map((a, i) => ({
        title: a.title,
        topic: a.topic,
        source: a.sourceLabel,
        summary: a.summary,
        text: texts[i],
      })),
      (liked ?? []).map((k) => k.keyword as string),
      new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    );

    const toStory = (s: WrittenStory): EditionStory => ({
      headline: s.headline,
      paragraphs: s.paragraphs,
      articles: s.sources.map((n) => ({
        id: articles[n].id,
        title: articles[n].title,
        link: articles[n].link,
        source: articles[n].sourceLabel,
      })),
    });
    const content: Edition = {
      summary: written.summary,
      lead: toStory(written.lead),
      sections: written.sections.map((sec) => ({ name: sec.name, stories: sec.stories.map(toStory) })),
    };

    const { error } = await supabase
      .from("news_editions")
      .update({ status: "ready", content, error: null })
      .eq("edition_date", dateStr);
    if (error) console.error("ensureEdition save error:", error);
  } catch (err) {
    console.error("ensureEdition failed:", err);
    const message = err instanceof Error ? err.message : "Couldn't write today's paper.";
    const { error } = await supabase
      .from("news_editions")
      .update({ status: "failed", error: message })
      .eq("edition_date", dateStr);
    if (error) console.error("ensureEdition failure save error:", error);
  }
}
