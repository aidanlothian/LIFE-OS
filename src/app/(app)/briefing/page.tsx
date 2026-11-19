import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAppDay } from "@/lib/appDay";
import { getEdition, type EditionStory } from "@/lib/newsEdition";
import ArticleReactions from "../ArticleReactions";

export const metadata = { title: "Daily Briefing" };

// The full Daily Briefing paper. Home shows its front page and links here.
export default async function BriefingPage() {
  const today = getAppDay();
  const edition = await getEdition(today);
  const dateLabel = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  if (!edition || edition.status !== "ready" || !edition.content) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold">Daily Briefing</h1>
        <p className="mt-2 text-sm text-muted">
          Today&apos;s paper isn&apos;t ready yet. It starts writing when you open{" "}
          <Link href="/" className="underline hover:text-accent">
            Home
          </Link>
          .
        </p>
      </div>
    );
  }

  const paper = edition.content;
  const ids = [paper.lead, ...paper.sections.flatMap((s) => s.stories)].flatMap((s) => s.articles.map((a) => a.id));
  const { data: feedback } = await createClient()
    .from("news_feedback")
    .select("article_id, reaction")
    .in("article_id", ids);
  const reactions = new Map((feedback ?? []).map((f) => [f.article_id, f.reaction as "like" | "dislike"]));

  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-8 pb-16">
      <header className="border-b-2 border-text pb-3 text-center">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted">{dateLabel}</p>
        <h1 className="mt-1 font-serif text-4xl font-semibold">The Daily Briefing</h1>
      </header>

      <section className="rounded-lg border border-border bg-panel p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">What you need to know</h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
          {paper.summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <Story story={paper.lead} reactions={reactions} lead />

      {paper.sections.map((section) => (
        <section key={section.name}>
          <h2 className="mb-3 border-b border-border pb-1 text-xs font-semibold uppercase tracking-[0.15em] text-muted">
            {section.name}
          </h2>
          <div className="flex flex-col gap-5">
            {section.stories.map((story) => (
              <Story key={story.headline} story={story} reactions={reactions} />
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}

function Story({
  story,
  reactions,
  lead = false,
}: {
  story: EditionStory;
  reactions: Map<string, "like" | "dislike">;
  lead?: boolean;
}) {
  // Reacting to a story counts toward its first source article.
  const main = story.articles[0];
  return (
    <div>
      <h3 className={lead ? "font-serif text-2xl font-semibold leading-tight" : "font-serif text-lg font-semibold leading-snug"}>
        {story.headline}
      </h3>
      <div className={`mt-1.5 flex flex-col gap-2 leading-relaxed ${lead ? "text-[15px]" : "text-sm"}`}>
        {story.paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span>Read more:</span>
        {story.articles.map((a) => (
          <a key={a.id} href={a.link} target="_blank" rel="noreferrer" title={a.title} className="underline hover:text-accent">
            {a.source}
          </a>
        ))}
        {main && (
          <span className="ml-auto">
            <ArticleReactions articleId={main.id} reaction={reactions.get(main.id) ?? null} />
          </span>
        )}
      </div>
    </div>
  );
}
