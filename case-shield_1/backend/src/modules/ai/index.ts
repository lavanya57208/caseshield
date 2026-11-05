import { env } from "@/config/env";
import { AIProvider } from "@/modules/ai/ai-provider.types";
import { MockAIProvider } from "@/modules/ai/mock-ai.provider";
import { VertexAIProvider } from "@/modules/ai/vertex-ai.provider";

let instance: AIProvider | undefined;

export function getAIProvider(): AIProvider {
  if (!instance) {
    instance = env.AI_PROVIDER === "mock" ? new MockAIProvider() : new VertexAIProvider();
  }
  return instance;
}
