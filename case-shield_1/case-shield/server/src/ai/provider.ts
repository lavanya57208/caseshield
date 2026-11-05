/**
 * AI Document Intelligence - provider abstraction
 * ---------------------------------------------------------------------------
 * Case Shield never fakes an AI response. If no provider is configured, every
 * method below returns a `configured: false` result and the UI shows an
 * honest "AI service not configured" state instead of invented content.
 *
 * To connect a real provider in production: implement AIProvider (call an
 * LLM API using a server-side-only key from process.env.AI_API_KEY) and
 * return it from getAIProvider() when AI_PROVIDER is set. The API key must
 * never be sent to the frontend.
 */

export interface AIClassification {
  configured: boolean;
  documentType?: string;
  confidence?: number;
}

export interface AIMetadataExtraction {
  configured: boolean;
  entities?: string[];
  importantDates?: string[];
}

export interface AISummary {
  configured: boolean;
  summary?: string;
  keyFindings?: string[];
}

export interface AISimilarDocument {
  configured: boolean;
  matches?: { documentId: string; title: string; similarity: number }[];
}

export interface AIProvider {
  readonly name: string;
  classify(text: string): Promise<AIClassification>;
  extractMetadata(text: string): Promise<AIMetadataExtraction>;
  summarize(text: string): Promise<AISummary>;
  findSimilar(documentId: string): Promise<AISimilarDocument>;
}

class NullAIProvider implements AIProvider {
  readonly name = "none";
  async classify(): Promise<AIClassification> {
    return { configured: false };
  }
  async extractMetadata(): Promise<AIMetadataExtraction> {
    return { configured: false };
  }
  async summarize(): Promise<AISummary> {
    return { configured: false };
  }
  async findSimilar(): Promise<AISimilarDocument> {
    return { configured: false };
  }
}

let cachedProvider: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (cachedProvider) return cachedProvider;
  // No AI_PROVIDER / AI_API_KEY configured in this environment -> honest
  // "not configured" provider. Swap in a real implementation here when keys
  // are available; never read AI_API_KEY anywhere outside this server.
  if (process.env.AI_PROVIDER && process.env.AI_API_KEY) {
    // Placeholder for a real integration - intentionally not implemented in
    // this prototype since no credentials are configured in this session.
    cachedProvider = new NullAIProvider();
  } else {
    cachedProvider = new NullAIProvider();
  }
  return cachedProvider;
}
