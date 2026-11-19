import { giveArticleFeedback } from "./newsActions";

// 👍/👎 on one article. Emoji glyphs ignore CSS text color, so the chosen
// reaction is shown with opacity + a background instead.
export default function ArticleReactions({
  articleId,
  reaction,
}: {
  articleId: string;
  reaction: "like" | "dislike" | null;
}) {
  return (
    <span className="flex items-center gap-1">
      <form action={giveArticleFeedback.bind(null, articleId, "like")}>
        <button
          type="submit"
          aria-label="More like this"
          className={`rounded px-1 py-0.5 transition ${
            reaction === "like" ? "bg-good/20 opacity-100" : "opacity-40 hover:opacity-80"
          }`}
        >
          👍
        </button>
      </form>
      <form action={giveArticleFeedback.bind(null, articleId, "dislike")}>
        <button
          type="submit"
          aria-label="Less like this"
          className={`rounded px-1 py-0.5 transition ${
            reaction === "dislike" ? "bg-bad/20 opacity-100" : "opacity-40 hover:opacity-80"
          }`}
        >
          👎
        </button>
      </form>
    </span>
  );
}
