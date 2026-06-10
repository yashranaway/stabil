import type { AudienceScoreResult } from "@stabil/scoring";
import type { RawAnswers } from "@stabil/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** RFC 9457 problem+json shape the API returns on error. */
interface ProblemDetails {
  title?: string;
  detail?: string;
  status?: number;
}

/** POST the raw answers to the stateless scoring endpoint and return the report. */
export async function scoreAnswers(answers: RawAnswers): Promise<AudienceScoreResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ answers }),
    });
  } catch {
    throw new Error(
      `Could not reach the scoring API at ${API_BASE}. Is it running?`,
    );
  }

  if (!res.ok) {
    let message = `Scoring failed (HTTP ${res.status}).`;
    try {
      const problem = (await res.json()) as ProblemDetails;
      message = problem.detail ?? problem.title ?? message;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new Error(message);
  }

  return (await res.json()) as AudienceScoreResult;
}
