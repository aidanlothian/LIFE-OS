import type { VisionWord } from "./journalVision";

export interface JournalParseResult {
  targets: string[]; // "Today's Targets" 1-3 -> becomes "3 Things"
  todos: string[]; // the hour-numbered column (6...12...9) -> regular to-dos
}

// The page is laid out in two columns: Today's Targets (numbered 1-3) sits
// in the left column, and the actual to-do list is the hour-labeled column
// (6, 7, 8 ... 12, 1, 2 ... 9) on the right. These fractions of the page's
// pixel width are the first guess at where that boundary and the far-right
// edge (past which a sliver of the facing page can bleed into frame) fall —
// tuned against one real photo, most likely to need adjustment for others.
const COLUMN_SPLIT_FRACTION = 0.55;
const RIGHT_EDGE_FRACTION = 0.92;

interface Line {
  text: string;
  y0: number;
  y1: number;
  cy: number;
}

// Groups words into lines by vertical position, independent of Vision's own
// paragraph boundaries. Only used *within* one item's already-isolated word
// bucket (see bucketByMarkers) to work out reading order across a wrapped
// second line — safe there since every word in the bucket is already known
// to belong to the same item.
function clusterLines(words: VisionWord[], pageHeight: number): Line[] {
  const pad = pageHeight * 0.003;
  const sorted = [...words].sort((a, b) => a.y0 - b.y0);

  const lines: { words: VisionWord[]; maxY1: number }[] = [];
  for (const w of sorted) {
    const current = lines[lines.length - 1];
    if (current && w.y0 <= current.maxY1 + pad) {
      current.words.push(w);
      current.maxY1 = Math.max(current.maxY1, w.y1);
    } else {
      lines.push({ words: [w], maxY1: w.y1 });
    }
  }

  return lines.map((l) => {
    const ordered = [...l.words].sort((a, b) => a.cx - b.cx);
    const y0 = Math.min(...l.words.map((w) => w.y0));
    const y1 = Math.max(...l.words.map((w) => w.y1));
    return {
      text: ordered.map((w) => w.text).join(" "),
      y0,
      y1,
      cy: (y0 + y1) / 2,
    };
  });
}

// Removes words that are never real content: the book's printed "N ○○○○○"
// progress circles (detected as runs of "0"s, sometimes with a bounding box
// tall enough to overlap neighboring rows) always, plus whichever
// zone-specific set of fixed printed-label tokens is passed in (e.g.
// "30-min-blocks" beside Targets, "plan-reality-score" below the to-do
// column). These are the same words every single day since they're
// printed, not handwritten, so matching their literal text is reliable —
// unlike excluding anything merely *near* them by pixel distance, which on
// this page also caught a real handwritten word sitting close to the
// printed label by coincidence. Deliberately excludes ambiguous tokens
// like "time" that can also legitimately appear in handwritten content.
function stripBoilerplate(words: VisionWord[], exactMatches: Set<string>): VisionWord[] {
  return words.filter((w) => {
    if (/^0+$/.test(w.text)) return false;
    const bare = w.text.replace(/[:.,()-]/g, "").toLowerCase();
    return !exactMatches.has(bare);
  });
}

// A word that's just the book's printed marker number for a row, e.g. "1."
// or "12" — as opposed to a word that happens to also be a number but is
// part of handwritten content.
function markerNumber(text: string, max: number): number | null {
  const m = text.trim().match(/^(\d{1,2})[.)]?$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= max ? n : null;
}

// The core of extracting a column's items: assigns every non-marker word to
// its nearest marker using the midpoint between *consecutive* markers as
// the boundary, rather than requiring a word's own position to fall below
// its marker's — content printed on the same row as a marker can have its
// center sit slightly above or below the marker digit itself (different
// baselines, tall ascenders), and a strict "marker.y <= word.y" rule drops
// exactly that content. This also naturally absorbs a wrapped second line
// of handwriting into the right item, without needing a separate
// row-spacing heuristic: as long as the *next* marker was found, anything
// above it and below the current one belongs to the current item.
//
// Markers are kept in position order and are NOT deduplicated by their
// digit value: the to-do column's hour labels wrap past 12 back to 1, so
// "6" and "7" each print twice on the page (once in the morning half, once
// in the evening half) — collapsing repeats by value would silently merge
// an evening item into its morning namesake.
function bucketByMarkers(words: VisionWord[], max: number, pageHeight: number): string[] {
  const markers = words
    .map((w) => ({ w, n: markerNumber(w.text, max) }))
    .filter((x): x is { w: VisionWord; n: number } => x.n !== null)
    .sort((a, b) => a.w.cy - b.w.cy);

  if (markers.length === 0) {
    // No markers detected at all (OCR missed every one) — fall back to one
    // item per visual line, best effort.
    const lines = clusterLines(words, pageHeight).sort((a, b) => a.cy - b.cy);
    return lines.map((l) => l.text.trim()).filter(Boolean);
  }

  const markerWordSet = new Set(markers.map((m) => m.w));
  // A lone "." detected as its own word is always a marker's punctuation
  // that didn't get fused with its digit — never meaningful content on its
  // own, unlike "(" / ")" which pair with real words like "(planning)".
  const contentWords = words.filter((w) => !markerWordSet.has(w) && w.text.trim() !== ".");

  // boundaries[i] is the lower cy cutoff for markers[i]'s bucket.
  const boundaries = markers.map((m, i) =>
    i === 0 ? -Infinity : (markers[i - 1].w.cy + m.w.cy) / 2
  );

  const buckets: VisionWord[][] = markers.map(() => []);
  for (const cw of contentWords) {
    let idx = 0;
    for (let i = 0; i < markers.length; i++) {
      if (cw.cy >= boundaries[i]) idx = i;
      else break;
    }
    buckets[idx].push(cw);
  }

  const items: string[] = [];
  markers.forEach((_, i) => {
    const bucket = buckets[i];
    if (bucket.length === 0) return; // empty row — nothing was written
    const lines = clusterLines(bucket, pageHeight).sort((a, b) => a.cy - b.cy);
    const text = lines.map((l) => l.text.trim()).filter(Boolean).join(" ");
    if (text) items.push(text);
  });
  return items;
}

// Turns the raw words Vision found on a journal page photo into candidate
// "3 Things" and to-do items, purely by position on the page.
export function parseJournalParagraphs(
  rawWords: VisionWord[],
  pageWidth: number,
  pageHeight: number
): JournalParseResult {
  const splitX = pageWidth * COLUMN_SPLIT_FRACTION;
  const rightEdge = pageWidth * RIGHT_EDGE_FRACTION;

  // Anchors are matched against individual words, not clustered lines —
  // clustering nearby words into a line for the anchor risked pulling in
  // unrelated content sitting close to it vertically, which inflated the
  // anchor's bounding box and ate into the zone it's meant to bound. A
  // single word's own box can't be contaminated that way.
  const leftWordsAll = rawWords.filter((w) => w.cx < splitX);
  const targetsAnchor = leftWordsAll.find((w) => /target/i.test(w.text));
  const greatAnchor = leftWordsAll.find((w) => /great/i.test(w.text));

  // "greatAnchor" matches just the word "great" out of the full printed
  // phrase "What will make today great?" — the other words in that phrase
  // can have a y0 a few pixels above "great"'s own (different letterforms,
  // ascenders), so a boundary sitting exactly at greatAnchor.y0 lets part
  // of the phrase leak into the last Target item. This margin clears the
  // whole heading line. The Targets heading needs no equivalent margin on
  // its own start boundary — checked against the real photo, its other
  // words never sit low enough to reach past "TARGETS:" itself.
  const headingMargin = pageHeight * 0.02;

  let targets: string[] = [];
  if (targetsAnchor) {
    const zoneBottom = greatAnchor
      ? greatAnchor.y0 - headingMargin
      : targetsAnchor.y1 + pageHeight * 0.3;
    const leftWords = stripBoilerplate(
      rawWords.filter((w) => w.cx < splitX && w.y0 >= targetsAnchor.y1 - 4 && w.y0 < zoneBottom),
      new Set(["min", "blocks", "30"])
    );
    targets = bucketByMarkers(leftWords, 3, pageHeight).slice(0, 3);
  }

  const rightWords = stripBoilerplate(
    rawWords.filter((w) => w.cx >= splitX && w.cx < rightEdge),
    new Set(["plan", "reality", "score"])
  );
  const todos = bucketByMarkers(rightWords, 12, pageHeight);

  return { targets, todos };
}
