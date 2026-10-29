"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { extractKeywords } from "@/lib/news";

// Toggle semantics: clicking the same reaction again removes it (undoing
// its score delta); clicking the opposite reaction switches it (undoing the
// old delta and applying the new one). This is the entire "learning"
// mechanism — plain per-keyword addition/subtraction, applied once per
// click, nothing hidden.
export async function giveArticleFeedback(articleId: string, reaction: "like" | "dislike") {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: article } = await supabase
    .from("news_articles")
    .select("title")
    .eq("id", articleId)
    .single();
  if (!article) return;

  const { data: existing } = await supabase
    .from("news_feedback")
    .select("reaction")
    .eq("user_id", user.id)
    .eq("article_id", articleId)
    .maybeSingle();

  const keywords = extractKeywords(article.title);
  const sign = (r: "like" | "dislike") => (r === "like" ? 1 : -1);

  let delta = 0;
  if (!existing) {
    delta = sign(reaction);
    await supabase.from("news_feedback").insert({ user_id: user.id, article_id: articleId, reaction });
  } else if (existing.reaction === reaction) {
    delta = -sign(reaction);
    await supabase.from("news_feedback").delete().eq("user_id", user.id).eq("article_id", articleId);
  } else {
    delta = sign(reaction) * 2;
    await supabase
      .from("news_feedback")
      .update({ reaction })
      .eq("user_id", user.id)
      .eq("article_id", articleId);
  }

  if (delta !== 0 && keywords.length > 0) {
    const { data: rows } = await supabase
      .from("news_keyword_scores")
      .select("keyword, score")
      .eq("user_id", user.id)
      .in("keyword", keywords);
    const current = new Map((rows ?? []).map((r) => [r.keyword, r.score as number]));

    await supabase.from("news_keyword_scores").upsert(
      keywords.map((k) => ({
        user_id: user.id,
        keyword: k,
        score: (current.get(k) ?? 0) + delta,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "user_id,keyword" }
    );
  }

  revalidatePath("/");
}
