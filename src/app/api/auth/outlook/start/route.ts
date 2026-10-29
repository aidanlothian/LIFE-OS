import { NextResponse } from "next/server";
import { getOutlookAuthUrl } from "@/lib/outlook";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.redirect(getOutlookAuthUrl());
}
