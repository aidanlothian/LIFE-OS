import Anthropic from "@anthropic-ai/sdk";

// Server-only: asks Claude which of the user's budget categories each merchant
// belongs in. Only merchant descriptions and category names are sent (no
// amounts, dates or account names). Needs ANTHROPIC_API_KEY.

export interface MerchantToSort {
  key: string; // merchantKey()
  example: string; // one full description as the bank wrote it
}

const BATCH = 60;

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Returns merchant key -> category name (or null when Claude isn't sure).
// Throws on API errors so the caller can report them.
export async function sortMerchants(
  merchants: MerchantToSort[],
  categoryNames: string[]
): Promise<Map<string, string | null>> {
  const client = new Anthropic();
  const batches: MerchantToSort[][] = [];
  for (let i = 0; i < merchants.length; i += BATCH) batches.push(merchants.slice(i, i + BATCH));
  const results = await Promise.all(batches.map((b) => sortBatch(client, b, categoryNames)));
  const out = new Map<string, string | null>();
  for (const r of results) for (const [k, v] of r) out.set(k, v);
  return out;
}

async function sortBatch(
  client: Anthropic,
  merchants: MerchantToSort[],
  categoryNames: string[]
): Promise<Map<string, string | null>> {
  const UNSURE = "Unsure";
  const schema = {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            category: { type: "string", enum: [...categoryNames, UNSURE] },
          },
          required: ["id", "category"],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  };

  const list = merchants.map((m, i) => `${i}: ${m.example}`).join("\n");
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system:
      "You sort credit card and bank transactions into a person's own budget categories. " +
      "Each line is a merchant description exactly as the bank printed it. Pick the single best category " +
      "from the allowed list for each one. Use what the merchant is known for (Trader Joe's is groceries, " +
      "Shell is gas, Netflix is a subscription). Answer \"Unsure\" when the description is too vague to tell " +
      "(a person's name, a bare reference number, a generic payment) rather than guessing.",
    messages: [
      {
        role: "user",
        content: `Categories: ${categoryNames.join(", ")}\n\nTransactions:\n${list}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") return new Map();
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let parsed: { results?: { id: number; category: string }[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error("sortMerchants: unreadable response", response.stop_reason);
    return new Map();
  }
  const out = new Map<string, string | null>();
  for (const r of parsed.results ?? []) {
    const m = merchants[r.id];
    if (!m) continue;
    out.set(m.key, r.category === UNSURE || !categoryNames.includes(r.category) ? null : r.category);
  }
  return out;
}
