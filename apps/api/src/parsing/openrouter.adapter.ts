import { extractedResumeSchema, type ExtractedResume } from "@stabil/types";

import type { LlmAdapter } from "./llm-adapter";

const SYSTEM_PROMPT = `You extract structured data from a resume. Respond with ONLY a JSON object with these keys:
fullName (string|null), totalExperienceYears (number|null), averageTenureMonths (number|null),
educationPercentage (0-100|null), projectsCount (int|null), programmingLanguages (string[]),
spokenLanguages (string[]), certificationsCount (int|null), currentLocation (string|null),
confidence (0-1). Use null when a field is not present. Do not invent values.`;

/**
 * Free OpenRouter models are shared across all OpenRouter users and their upstream
 * providers frequently rate-limit at busy times (HTTP 429, "temporarily rate-limited
 * upstream"). Pull whatever the model's response actually contains out of markdown
 * fences or surrounding prose — some free models don't strictly honor
 * response_format: json_object.
 */
function extractJsonBlock(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text;
}

/**
 * Default adapter: calls an OpenRouter chat-completions model in JSON mode. Accepts a
 * comma-separated list of models and tries each in order — if one is congested
 * upstream, the next is attempted before giving up.
 */
export class OpenRouterAdapter implements LlmAdapter {
  private readonly models: string[];

  constructor(
    private readonly apiKey: string,
    models: string,
    private readonly baseUrl: string,
  ) {
    this.models = models
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
  }

  async extract(resumeText: string): Promise<ExtractedResume> {
    let lastError: unknown;
    for (const model of this.models) {
      try {
        return await this.tryModel(model, resumeText);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("All OpenRouter models failed");
  }

  private async tryModel(model: string, resumeText: string): Promise<ExtractedResume> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: resumeText },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenRouter request failed for ${model} (HTTP ${res.status})`);
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? "{}";

    let raw: unknown;
    try {
      raw = JSON.parse(extractJsonBlock(content));
    } catch {
      throw new Error(`OpenRouter returned non-JSON content for ${model}`);
    }

    const parsed = extractedResumeSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`OpenRouter output failed schema validation for ${model}`);
    }
    // The model doesn't know about `source` — stamp it ourselves so callers can
    // trust this flag rather than relying on prompt compliance.
    return { ...parsed.data, source: "ai" };
  }
}
