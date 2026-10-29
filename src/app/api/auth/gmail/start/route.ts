import { NextResponse } from "next/server";
import { getGmailAuthUrl } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.redirect(getGmailAuthUrl());
}
