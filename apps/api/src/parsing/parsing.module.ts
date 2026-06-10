import { Module } from "@nestjs/common";

import { LLM_ADAPTER } from "./llm-adapter";
import { OpenRouterAdapter } from "./openrouter.adapter";
import { ParsingController } from "./parsing.controller";
import { ParsingService } from "./parsing.service";
import { StubLlmAdapter } from "./stub.adapter";

@Module({
  controllers: [ParsingController],
  providers: [
    ParsingService,
    {
      // Default to OpenRouter when a key is present; otherwise the deterministic stub.
      provide: LLM_ADAPTER,
      useFactory: () => {
        const key = process.env.OPENROUTER_API_KEY;
        if (key && key.trim().length > 0) {
          return new OpenRouterAdapter(
            key,
            process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
            process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
          );
        }
        return new StubLlmAdapter();
      },
    },
  ],
})
export class ParsingModule {}
