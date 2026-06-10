import { extractedResumeSchema, type ExtractedResume } from "@stabil/types";

import type { LlmAdapter } from "./llm-adapter";

const SYSTEM_PROMPT = `You extract structured data from a resume. Respond with ONLY a JSON object with these keys:
fullName (string|null), totalExperienceYears (number|null), averageTenureMonths (number|null),
educationPercentage (0-100|null), projectsCount (int|null), programmingLanguages (string[]),
spokenLanguages (string[]), certificationsCount (int|null), currentLocation (string|null),
confidence (0-1). Use null when a field is not present. Do not invent values.`;

/** Default adapter: calls an OpenRouter chat-completions model in JSON mode. */
export class OpenRouterAdapter implements LlmAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string,
  ) {}

  async extract(resumeText: string): Promise<ExtractedResume> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: resumeText },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenRouter request failed (HTTP ${res.status})`);
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? "{}";

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      throw new Error("OpenRouter returned non-JSON content");
    }

    const parsed = extractedResumeSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("OpenRouter output failed schema validation");
    }
    return parsed.data;
  }
}
