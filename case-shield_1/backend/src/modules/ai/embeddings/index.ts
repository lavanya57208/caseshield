import crypto from "crypto";
import { env } from "@/config/env";
import { GoogleTransport, defaultGoogleTransport, requireGoogleProject } from "@/modules/ai/google-rest";

// EmbeddingProvider — the seam for semantic / vector search (see
// docs/search-architecture.md §Intelligent search). Today vectors are
// computed on the fly for an already-AUTHORIZED candidate set and compared
// in memory; no vector database is used. A future pgvector column (or
// Vertex AI Vector Search) would store these per document version, and the
// authorization filter would still run first.

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

const STEM_SUFFIXES = ["ings", "ing", "ies", "ed", "es", "s"];
function stem(word: string) {
  for (const suffix of STEM_SUFFIXES) {
    if (word.length > suffix.length + 3 && word.endsWith(suffix)) return word.slice(0, -suffix.length);
  }
  return word;
}

/** Deterministic feature-hashing bag-of-words vectors. Offline; lexical, not truly semantic. */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "MockEmbeddingProvider (feature hashing, offline)";
  readonly dimensions = 256;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const v = new Array<number>(this.dimensions).fill(0);
      for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
        if (raw.length < 3) continue;
        const h = crypto.createHash("md5").update(stem(raw)).digest();
        v[h.readUInt16BE(0) % this.dimensions] += h[2] & 1 ? 1 : -1;
      }
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }
}

/** PRODUCTION ADAPTER — Vertex AI text embeddings (`:predict`). Not exercised without credentials. */
export class VertexEmbeddingProvider implements EmbeddingProvider {
  readonly name = `Vertex AI embeddings (${env.VERTEX_AI_EMBEDDING_MODEL})`;
  readonly dimensions = 768;

  constructor(private readonly transport: GoogleTransport = defaultGoogleTransport) {}

  async embed(texts: string[]): Promise<number[][]> {
    const { project, region } = requireGoogleProject("Vertex AI embeddings");
    const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/google/models/${env.VERTEX_AI_EMBEDDING_MODEL}:predict`;
    const response = await this.transport(url, { instances: texts.map((content) => ({ content: content.slice(0, 8000), task_type: "RETRIEVAL_DOCUMENT" })) });
    const predictions: any[] = response?.predictions ?? [];
    if (predictions.length !== texts.length) throw new Error("Vertex AI embeddings returned an unexpected number of vectors.");
    return predictions.map((p) => p?.embeddings?.values ?? []);
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

let instance: EmbeddingProvider | undefined;
export function getEmbeddingProvider(): EmbeddingProvider {
  if (!instance) instance = env.AI_PROVIDER === "mock" ? new MockEmbeddingProvider() : new VertexEmbeddingProvider();
  return instance;
}
