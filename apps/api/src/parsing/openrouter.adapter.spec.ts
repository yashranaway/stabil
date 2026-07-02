import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenRouterAdapter } from "./openrouter.adapter";

function mockChatResponse(content: string, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as Response;
}

const VALID_JSON = JSON.stringify({
  fullName: "Jordan Lee",
  totalExperienceYears: 9,
  averageTenureMonths: null,
  educationPercentage: null,
  projectsCount: 4,
  programmingLanguages: ["typescript", "go"],
  spokenLanguages: [],
  certificationsCount: 2,
  currentLocation: null,
  confidence: 0.85,
});

describe("OpenRouterAdapter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("parses a well-formed JSON response and stamps source: 'ai'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockChatResponse(VALID_JSON)));
    const adapter = new OpenRouterAdapter("key", "some/model:free", "https://openrouter.ai/api/v1");

    const result = await adapter.extract("resume text");

    expect(result.source).toBe("ai");
    expect(result.totalExperienceYears).toBe(9);
    expect(result.programmingLanguages).toEqual(["typescript", "go"]);
  });

  it("strips markdown code fences before parsing (some free models don't honor json_object strictly)", async () => {
    const fenced = "```json\n" + VALID_JSON + "\n```";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockChatResponse(fenced)));
    const adapter = new OpenRouterAdapter("key", "some/model:free", "https://openrouter.ai/api/v1");

    const result = await adapter.extract("resume text");
    expect(result.totalExperienceYears).toBe(9);
  });

  it("tries the next model in a comma-separated list when the first fails (e.g. upstream 429)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockChatResponse("rate limited", false, 429))
      .mockResolvedValueOnce(mockChatResponse(VALID_JSON));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OpenRouterAdapter("key", "model-a:free, model-b:free", "https://openrouter.ai/api/v1");
    const result = await adapter.extract("resume text");

    expect(result.totalExperienceYears).toBe(9);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("model-a:free");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe("model-b:free");
  });

  it("throws when every configured model fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockChatResponse("", false, 429)));
    const adapter = new OpenRouterAdapter("key", "model-a:free,model-b:free", "https://openrouter.ai/api/v1");

    await expect(adapter.extract("resume text")).rejects.toThrow();
  });
});
