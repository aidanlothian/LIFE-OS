import { NextResponse } from "next/server";
import { getGoogleAuthUrl } from "@/lib/googleCalendar";

// This is a redirect endpoint, never meaningfully static — without this,
// Next.js tries to prerender it at build time and fails on missing env
// vars before they're ever needed at runtime.
export const dynamic = "force-dynamic";

// Auth is already enforced by middleware for every non-/login route,
// including /api/*, so no extra check is needed here.
export async function GET() {
  return NextResponse.redirect(getGoogleAuthUrl());
}
