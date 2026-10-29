import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { detectDocumentText } from "@/lib/journalVision";
import { parseJournalParagraphs } from "@/lib/journalParse";

// Used as a Route Handler rather than a Server Action specifically because
// Server Actions have a low default body size limit unsuited to photo
// uploads; a Route Handler doesn't share that constraint.
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("photo");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No photo was uploaded." }, { status: 400 });
  }

  let buffer = Buffer.from(await file.arrayBuffer());

  const looksLikeHeic =
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    /\.hei[cf]$/i.test(file.name || "");

  if (looksLikeHeic) {
    try {
      // heic-convert has no bundled type declarations that match its actual
      // export shape in this project's module setup — @types/heic-convert
      // covers the runtime behavior we rely on (buffer in, buffer out).
      const convert = (await import("heic-convert")).default;
      const converted = await convert({ buffer, format: "JPEG", quality: 0.85 });
      buffer = Buffer.from(converted);
    } catch (err) {
      console.error("HEIC conversion failed:", err);
      return NextResponse.json(
        {
          error:
            "Couldn't read that HEIC photo. Try exporting it as JPEG first, or set your iPhone's Camera format to \"Most Compatible\" (Settings → Camera → Formats).",
        },
        { status: 400 }
      );
    }
  }

  try {
    // Phone photos carry an EXIF orientation tag telling viewers how to
    // rotate them for display, but Vision reads the raw pixel grid and
    // ignores it — without normalizing here, its bounding-box coordinates
    // end up in a rotated frame that doesn't match the page's actual
    // layout. sharp's rotate() with no args auto-rotates from that tag
    // (then strips it, since it's now redundant) and is a no-op if a photo
    // is already upright. Resizing alongside it keeps the request small.
    buffer = await sharp(buffer)
      .rotate()
      .resize({ width: 1800, withoutEnlargement: true })
      .jpeg({ quality: 87 })
      .toBuffer();

    const { words, pageWidth, pageHeight } = await detectDocumentText(buffer);
    const { targets, todos } = parseJournalParagraphs(words, pageWidth, pageHeight);
    return NextResponse.json({ targets, todos });
  } catch (err) {
    console.error("Journal photo OCR failed:", err);
    const message = err instanceof Error ? err.message : "Failed to read the photo.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
