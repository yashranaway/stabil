import { Module } from "@nestjs/common";

import { FallbackLlmAdapter } from "./fallback.adapter";
import { LLM_ADAPTER } from "./llm-adapter";
import { OpenRouterAdapter } from "./openrouter.adapter";
import { ParsingController } from "./parsing.controller";
import { ParsingService } from "./parsing.service";
import { StubLlmAdapter } from "./stub.adapter";

// Free-tier default: a couple of well-tested instruction-following models. Free
// OpenRouter models share upstream capacity and 429 at busy times, so trying a
// second model before giving up meaningfully improves reliability.
const DEFAULT_FREE_MODELS = "meta-llama/llama-3.3-70b-instruct:free,qwen/qwen3-next-80b-a3b-instruct:free";

@Module({
  controllers: [ParsingController],
  providers: [
    ParsingService,
    {
      // OpenRouter when a key is present (with a heuristic fallback if every
      // configured model is unavailable); otherwise the heuristic stub outright.
      provide: LLM_ADAPTER,
      useFactory: () => {
        const key = process.env.OPENROUTER_API_KEY;
        if (key && key.trim().length > 0) {
          const openRouter = new OpenRouterAdapter(
            key,
            // `||` (not `??`) so an empty string — e.g. an unset docker-compose var
            // interpolated to "" — also falls through to the default.
            process.env.OPENROUTER_MODEL?.trim() || DEFAULT_FREE_MODELS,
            process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
          );
          return new FallbackLlmAdapter(openRouter, new StubLlmAdapter());
        }
        return new StubLlmAdapter();
      },
    },
  ],
})
export class ParsingModule {}
