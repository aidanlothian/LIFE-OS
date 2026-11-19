import Anthropic from "@anthropic-ai/sdk";

// Server-only: Claude writes the day's Daily Briefing as a short personal
// newspaper. Which stories are in the running is still decided by the
// explainable keyword scores in news.ts (they arrive here in that order);
// Claude picks the lead, groups the rest into sections and writes them up
// from the article text. Sent: public article text and headlines, plus the
// keywords the user's 👍/👎 history scores highest. Needs ANTHROPIC_API_KEY.

export interface StoryInput {
  title: string;
  topic: string;
  source: string;
  summary: string | null;
  text: string | null; // the article body when it could be fetched
}

export interface WrittenStory {
  headline: string;
  paragraphs: string[];
  sources: number[]; // indexes into the StoryInput list
}

export interface WrittenEdition {
  summary: string[]; // "what you need to know" bullets
  lead: WrittenStory;
  sections: { name: string; stories: WrittenStory[] }[];
}

const story = {
  type: "object",
  properties: {
    headline: { type: "string" },
    paragraphs: { type: "array", items: { type: "string" } },
    sources: { type: "array", items: { type: "integer" } },
  },
  required: ["headline", "paragraphs", "sources"],
  additionalProperties: false,
};

const schema = {
  type: "object",
  properties: {
    summary: { type: "array", items: { type: "string" } },
    lead: story,
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, stories: { type: "array", items: story } },
        required: ["name", "stories"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "lead", "sections"],
  additionalProperties: false,
};

// Throws on API errors or an unusable answer.
export async function writeEdition(
  stories: StoryInput[],
  likedKeywords: string[],
  dateLabel: string
): Promise<WrittenEdition> {
  const list = stories
    .map((s, i) => {
      const body = s.text ?? (s.summary ? `(only the feed blurb is available) ${s.summary}` : "(headline only)");
      return `### [${i}] ${s.title}\nTopic: ${s.topic} | Source: ${s.source}\n${body}`;
    })
    .join("\n\n");

  const client = new Anthropic();
  const response = await client.messages.create(
    {
      // Haiku: summarizing text it's handed is well within its reach, at a
      // fraction of Opus's price (about $0.20 a month for one paper a day).
      model: "claude-haiku-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      system:
        "You are the editor of a one-reader morning newspaper. The reader follows sports (NBA, MLB, NFL), " +
        "US politics, world news, business and climate. They want to understand " +
        "the day's news in about five minutes of reading, and click through only when they want more.\n\n" +
        "You get today's candidate stories, already ranked by the reader's interests (most interesting first), " +
        "each with whatever article text could be fetched. Write the edition:\n" +
        "- summary: 3 to 5 one-sentence bullets, \"what you need to know today\", most important first.\n" +
        "- lead: the single story that matters most to this reader today, weighing their interests against " +
        "how significant the news is. A real headline and 2 to 4 short paragraphs: what happened, why it " +
        "matters, what comes next.\n" +
        "- sections: group the rest by subject (combine NBA, MLB and NFL into one \"Sports\" section), ordered " +
        "by the reader's interest. Each story gets a headline and one paragraph of 2 to 4 sentences. " +
        "Combine candidates that cover the same news into one story citing all of them. Leave out stories " +
        "that are trivial or that you know too little about; around 8 to 14 stories in total is right.\n" +
        "- sources: the [index] numbers of the candidates each story is based on. Every story needs at least one.\n\n" +
        "Write like a good newspaper: plain, specific, neutral, no hype, no filler like \"in a stunning turn\". " +
        "Use only facts in the provided text. When a candidate has only a headline or blurb, keep its write-up " +
        "short and don't add details you can't see. Never address the reader as \"you\" except in the summary.",
      messages: [
        {
          role: "user",
          content:
            `Edition date: ${dateLabel}\n` +
            `Topics the reader has liked before: ${likedKeywords.join(", ") || "(none yet)"}\n\n` +
            `Candidate stories:\n\n${list}`,
        },
      ],
    },
    { timeout: 180_000 }
  );

  if (response.stop_reason === "refusal") throw new Error("Claude declined to write today's paper.");
  if (response.stop_reason === "max_tokens") throw new Error("Today's paper ran too long to finish.");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let parsed: WrittenEdition;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Claude's paper came back unreadable.");
  }

  // Keep only source numbers that exist, and drop stories left with none.
  const valid = (s: WrittenStory): WrittenStory => ({
    headline: s.headline.trim(),
    paragraphs: s.paragraphs.map((p) => p.trim()).filter(Boolean),
    sources: Array.from(new Set(s.sources.filter((n) => Number.isInteger(n) && n >= 0 && n < stories.length))),
  });
  const lead = valid(parsed.lead);
  if (!lead.headline || lead.paragraphs.length === 0) throw new Error("Claude's paper had no lead story.");
  return {
    summary: parsed.summary.map((s) => s.trim()).filter(Boolean),
    lead,
    sections: parsed.sections
      .map((sec) => ({
        name: sec.name.trim(),
        stories: sec.stories.map(valid).filter((s) => s.headline && s.paragraphs.length > 0 && s.sources.length > 0),
      }))
      .filter((sec) => sec.name && sec.stories.length > 0),
  };
}
