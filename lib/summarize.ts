import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function envInt(name: string, fallback: number) {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

const MODEL = process.env.OPENAI_SUMMARY_MODEL ?? "gpt-5.2";
const MAX_INPUT_CHARS = envInt("OPENAI_SUMMARY_MAX_INPUT_CHARS", 8000);
const MAX_OUTPUT_TOKENS = envInt("OPENAI_SUMMARY_MAX_OUTPUT_TOKENS", 220);

export async function summarizeText(sourceText: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing in .env.local");
  }

  const trimmed = (sourceText ?? "").trim();
  if (!trimmed) return "";

  const clipped =
    trimmed.length > MAX_INPUT_CHARS ? trimmed.slice(0, MAX_INPUT_CHARS) : trimmed;

  try {
    const response = await client.responses.create({
      model: MODEL,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You are a concise assistant. Summarize the input into 3 to 6 bullet points. " +
                "Keep it factual. Preserve tickers, names, numbers, and links. No hype.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: clipped,
            },
          ],
        },
      ],
    });

    const out = (response.output_text ?? "").trim();
    return out.length ? out : "No summary generated.";
  } catch (err: any) {
    const message =
      err?.error?.message ||
      err?.message ||
      "Unknown OpenAI error while summarizing.";
    console.error("OpenAI summarize error:", err);
    throw new Error(message);
  }
}
