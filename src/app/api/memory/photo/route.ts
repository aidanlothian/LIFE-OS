import { randomUUID } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { PHOTO_BUCKET, PHOTO_URL_TTL_SECONDS } from "@/lib/memoryLayout";

// Uploads one photo for a Deep Memory Gallery widget. A Route Handler (not a
// Server Action) for the same reason as /api/journal/parse: Server Actions
// have a low body size limit that phone photos blow past.
//
// Every photo is shrunk before it's stored — at most 1600px on its longest
// side, as JPEG — so a gallery loads fast and the free Storage tier lasts.
// HEIC (iPhone) photos are converted first.

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const MAX_SIDE_PX = 1600;

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
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `“${file.name}” is over 30 MB.` }, { status: 400 });
  }

  let buffer = Buffer.from(await file.arrayBuffer());

  const looksLikeHeic =
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    /\.hei[cf]$/i.test(file.name || "");

  if (looksLikeHeic) {
    try {
      const convert = (await import("heic-convert")).default;
      const converted = await convert({ buffer, format: "JPEG", quality: 0.9 });
      buffer = Buffer.from(converted);
    } catch (err) {
      console.error("HEIC conversion failed:", err);
      return NextResponse.json(
        { error: `Couldn't read “${file.name}”. Try exporting it as a JPEG first.` },
        { status: 400 }
      );
    }
  }

  try {
    // rotate() with no args applies the phone's EXIF orientation (then
    // drops the tag), so photos never show up sideways.
    buffer = await sharp(buffer)
      .rotate()
      .resize({ width: MAX_SIDE_PX, height: MAX_SIDE_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch (err) {
    console.error("Photo resize failed:", err);
    return NextResponse.json(
      { error: `“${file.name}” doesn't look like a photo we can read.` },
      { status: 400 }
    );
  }

  const path = `${user.id}/${randomUUID()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, buffer, { contentType: "image/jpeg" });
  if (uploadError) {
    console.error("Photo upload failed:", uploadError);
    const missing = /bucket not found/i.test(uploadError.message);
    return NextResponse.json(
      {
        error: missing
          ? "Photo storage isn't set up yet. Run the latest supabase/schema.sql in Supabase first."
          : "Couldn't save the photo. Try again.",
      },
      { status: 500 }
    );
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(path, PHOTO_URL_TTL_SECONDS);
  if (signError) console.error("Signing new photo URL failed:", signError);

  return NextResponse.json({ path, url: signed?.signedUrl ?? null });
}
