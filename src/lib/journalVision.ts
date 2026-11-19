// Thin wrapper around Google Cloud Vision's REST API (no SDK dependency —
// same "plain fetch" approach used for RSS in src/lib/rss.ts). Uses
// DOCUMENT_TEXT_DETECTION, which Google recommends over plain TEXT_DETECTION
// for dense/handwritten text.
//
// Extracts individual WORD-level bounding boxes rather than Vision's own
// paragraph groupings: on this two-column page, Vision sometimes merges a
// line from the left column with a nearby line from the right column into
// one paragraph when they sit close together vertically. Splitting by
// column has to happen before re-grouping into lines, at the word level,
// or that contamination can't be undone — see journalParse.ts.

export interface VisionWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
}

interface VisionVertex {
  x?: number;
  y?: number;
}

interface VisionWordRaw {
  boundingBox?: { vertices?: VisionVertex[] };
  symbols?: { text: string }[];
}

interface VisionParagraphRaw {
  words?: VisionWordRaw[];
}

interface VisionBlock {
  paragraphs?: VisionParagraphRaw[];
}

interface VisionPage {
  blocks?: VisionBlock[];
  width?: number;
  height?: number;
}

interface VisionAnnotateResponse {
  responses?: {
    fullTextAnnotation?: { pages?: VisionPage[] };
    error?: { message?: string };
  }[];
}

function boundingBox(vertices: VisionVertex[]) {
  const xs = vertices.map((v) => v.x ?? 0);
  const ys = vertices.map((v) => v.y ?? 0);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

export interface VisionDocumentResult {
  words: VisionWord[];
  pageWidth: number;
  pageHeight: number;
}

// Reads a page of handwritten/printed text and returns every word Vision
// found, each with its own position on the page — journalParse.ts does its
// own line/column grouping from these rather than trusting Vision's.
export async function detectDocumentText(imageBuffer: Buffer): Promise<VisionDocumentResult> {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_VISION_API_KEY is not set — add it to .env.local (see setup instructions)."
    );
  }

  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          image: { content: imageBuffer.toString("base64") },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Vision API request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as VisionAnnotateResponse;
  const response = data.responses?.[0];
  if (response?.error) {
    throw new Error(`Vision API error: ${response.error.message ?? "unknown error"}`);
  }

  const pages = response?.fullTextAnnotation?.pages ?? [];
  const words: VisionWord[] = [];
  let pageWidth = 0;
  let pageHeight = 0;
  for (const page of pages) {
    pageWidth = Math.max(pageWidth, page.width ?? 0);
    pageHeight = Math.max(pageHeight, page.height ?? 0);
    for (const block of page.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const w of para.words ?? []) {
          const text = (w.symbols ?? []).map((s) => s.text).join("");
          const vertices = w.boundingBox?.vertices ?? [];
          if (!text || vertices.length === 0) continue;
          words.push({ text, ...boundingBox(vertices) });
        }
      }
    }
  }

  if (pageWidth === 0) pageWidth = Math.max(1, ...words.map((w) => w.x1));
  if (pageHeight === 0) pageHeight = Math.max(1, ...words.map((w) => w.y1));

  return { words, pageWidth, pageHeight };
}
