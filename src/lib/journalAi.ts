import Anthropic from "@anthropic-ai/sdk";

// Server-only: Claude reads a photo of the user's "Self Journal" daily page and
// pulls out what he wrote. Replaces the old Google Vision OCR + position
// parsing (journalVision.ts / journalParse.ts), which needed hand-tuned page
// fractions and broke on photos taken at a different angle. Only the photo
// is sent. Needs ANTHROPIC_API_KEY.

export interface JournalReadResult {
  targets: string[]; // "Today's Targets" 1-3 -> becomes "3 Things"
  todos: string[]; // the hour-numbered schedule column -> regular to-dos
}

const schema = {
  type: "object",
  properties: {
    targets: { type: "array", items: { type: "string" } },
    todos: { type: "array", items: { type: "string" } },
  },
  required: ["targets", "todos"],
  additionalProperties: false,
};

// Throws on API errors or an unreadable answer so the route can report them.
export async function readJournalPage(jpeg: Buffer): Promise<JournalReadResult> {
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system:
      "You transcribe a photo of one handwritten page from a paper daily planner (the Self Journal). " +
      "The page has a \"Today's Targets\" section with rows numbered 1 to 3, and a schedule column whose " +
      "rows are labelled with hours (6, 7, 8 ... 12, 1, 2 ... 9). Return the handwritten Targets in order as " +
      "`targets`, and every handwritten entry in the hour column, top to bottom, as `todos`. " +
      "Transcribe the person's words faithfully, fixing only obvious letter misreads; join a wrapped second " +
      "line onto its item. Leave out the hour numbers, row numbers, check marks, and anything printed by " +
      "the book itself (headings, labels, progress circles, quotes). Skip empty rows, and ignore any of the " +
      "facing page that shows at the edge of the photo. If a word is illegible, give your best reading.",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } },
          { type: "text", text: "Transcribe this page." },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("Claude couldn't read that photo.");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let parsed: Partial<JournalReadResult>;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error("readJournalPage: unreadable response", response.stop_reason);
    throw new Error("Couldn't make sense of that photo. Try again or take a clearer one.");
  }
  const clean = (items: unknown) =>
    Array.isArray(items) ? items.map((s) => String(s).trim()).filter(Boolean) : [];
  return { targets: clean(parsed.targets).slice(0, 3), todos: clean(parsed.todos) };
}
