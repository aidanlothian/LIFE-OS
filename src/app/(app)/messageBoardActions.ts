"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { invalidateEmailBoardCache } from "@/lib/messageBoard";

// Local-only "I've seen this" marker — doesn't mark the message read in
// Gmail/Outlook, just stops it from showing on the board. A genuinely new
// email always has its own message_id, so it isn't affected.
export async function dismissEmail(accountId: string, messageId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("email_dismissed").upsert(
    { user_id: user.id, account_id: accountId, message_id: messageId },
    { onConflict: "account_id,message_id", ignoreDuplicates: true }
  );
  if (error) console.error("dismissEmail failed:", error);
  invalidateEmailBoardCache(user.id);
  revalidatePath("/");
}

export async function disconnectEmailAccount(accountId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await supabase.from("email_accounts").delete().eq("id", accountId).eq("user_id", user.id);
  invalidateEmailBoardCache(user.id);
  revalidatePath("/");
}
