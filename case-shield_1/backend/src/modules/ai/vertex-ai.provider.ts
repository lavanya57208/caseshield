import {
  AIProvider,
  ClassificationResult,
  DOCUMENT_CLASSIFICATION_TYPES,
  DocumentClassificationType,
  ExtractedField,
  MetadataExtractionResult,
  MetadataValue,
  SearchQueryInterpretation,
  StructuredDocumentMetadata,
  SummaryResult,
} from "@/modules/ai/ai-provider.types";
import { env } from "@/config/env";
import { GoogleTransport, defaultGoogleTransport, requireGoogleProject } from "@/modules/ai/google-rest";
import { cosineSimilarity, VertexEmbeddingProvider } from "@/modules/ai/embeddings";
import { normalizeDate } from "@/modules/ai/heuristics";

// PRODUCTION ADAPTER — Vertex AI (Gemini `generateContent`, JSON mode).
// Not exercised against a live project in this environment (no GCP
// credentials); request shaping and response validation are unit-tested
// with an injected transport. Authorization, the RESTRICTED policy and PII
// masking all happen in the calling services BEFORE this class is called —
// see docs/ai-architecture.md and docs/security-architecture.md §11.
//
// Model output is treated as untrusted input: every field is validated,
// out-of-taxonomy values are discarded, and identifier-like values that do
// not appear verbatim in the source text are dropped (anti-fabrication).

const SYSTEM_INSTRUCTION = [
  "You are an assistive document-processing component inside a legal case-management system.",
  "Use ONLY the text provided. Do not infer, assume or invent facts that are not present.",
  "If a value is not explicitly present, return null for it.",
  "Never state or imply guilt, innocence, liability, or any legal conclusion, and never give legal advice.",
  "Personal identifiers in the text are masked; never attempt to reconstruct them.",
].join(" ");

const MAX_PROMPT_CHARS = 30_000;
const clamp01 = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export class VertexAIProvider implements AIProvider {
  readonly name = `VertexAIProvider (production, ${env.VERTEX_AI_MODEL})`;

  constructor(
    private readonly transport: GoogleTransport = defaultGoogleTransport,
    private readonly embeddings = new VertexEmbeddingProvider(transport),
  ) {}

  private async generate(prompt: string, responseSchema?: object): Promise<string> {
    const { project, region } = requireGoogleProject("Vertex AI");
    const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/google/models/${env.VERTEX_AI_MODEL}:generateContent`;
    const response = await this.transport(url, {
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2048,
        ...(responseSchema ? { responseMimeType: "application/json", responseSchema } : {}),
      },
    });
    const text = response?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
    if (!text) throw new Error("Vertex AI returned an empty response.");
    return text;
  }

  private async generateJson(prompt: string, schema: object): Promise<any> {
    const raw = await this.generate(prompt, schema);
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("Vertex AI returned malformed JSON.");
    }
  }

  async classifyDocument(input: { fileName: string; textSample: string }): Promise<ClassificationResult> {
    const out = await this.generateJson(
      `Classify this document into exactly one type: ${DOCUMENT_CLASSIFICATION_TYPES.join(", ")}. Use OTHER when unsure.\nFile name: ${input.fileName}\n---\n${input.textSample.slice(0, MAX_PROMPT_CHARS)}`,
      {
        type: "OBJECT",
        properties: {
          suggestedType: { type: "STRING", enum: [...DOCUMENT_CLASSIFICATION_TYPES] },
          confidence: { type: "NUMBER" },
          rationale: { type: "STRING" },
        },
        required: ["suggestedType", "confidence"],
      },
    );
    const type = DOCUMENT_CLASSIFICATION_TYPES.includes(out?.suggestedType) ? (out.suggestedType as DocumentClassificationType) : "OTHER";
    return { suggestedType: type, confidence: type === "OTHER" ? Math.min(clamp01(out?.confidence), 0.5) : clamp01(out?.confidence), rationale: str(out?.rationale)?.slice(0, 300) ?? undefined };
  }

  async extractMetadata(input: { fileName: string; mimeType: string; textSample: string }): Promise<MetadataExtractionResult> {
    const text = input.textSample.slice(0, MAX_PROMPT_CHARS);
    const valueSchema = (valueType: object) => ({ type: "OBJECT", properties: { value: { ...valueType, nullable: true }, confidence: { type: "NUMBER" } } });
    const out = await this.generateJson(
      `Extract metadata from this document. Return null for anything not explicitly present. Dates as YYYY-MM-DD.\nFile name: ${input.fileName}\n---\n${text}`,
      {
        type: "OBJECT",
        properties: {
          caseNumber: valueSchema({ type: "STRING" }),
          documentDate: valueSchema({ type: "STRING" }),
          documentTitle: valueSchema({ type: "STRING" }),
          documentType: valueSchema({ type: "STRING", enum: [...DOCUMENT_CLASSIFICATION_TYPES] }),
          author: valueSchema({ type: "STRING" }),
          department: valueSchema({ type: "STRING" }),
          evidenceIds: valueSchema({ type: "ARRAY", items: { type: "STRING" } }),
          parties: valueSchema({ type: "ARRAY", items: { type: "OBJECT", properties: { role: { type: "STRING" }, name: { type: "STRING" } } } }),
          identifiers: valueSchema({ type: "ARRAY", items: { type: "OBJECT", properties: { label: { type: "STRING" }, value: { type: "STRING" } } } }),
          tags: valueSchema({ type: "ARRAY", items: { type: "STRING" } }),
        },
      },
    );
    const fields = validateMetadata(out, text);
    const entities: ExtractedField[] = [];
    if (fields.documentType.value) entities.push({ label: "Suggested document type", value: fields.documentType.value, confidence: fields.documentType.confidence });
    if (fields.caseNumber.value) entities.push({ label: "Referenced case number", value: fields.caseNumber.value, confidence: fields.caseNumber.confidence });
    if (fields.documentDate.value) entities.push({ label: "Referenced date", value: fields.documentDate.value, confidence: fields.documentDate.confidence });
    return { documentType: fields.documentType.value ?? undefined, suggestedCaseNumber: fields.caseNumber.value ?? undefined, entities, fields, extractedAt: new Date().toISOString() };
  }

  async summarizeDocument(input: { textSample: string }): Promise<SummaryResult> {
    const summary = await this.generate(
      `Write a concise, factual summary (at most 5 sentences) of the following document, using only its content. Do not add opinions, legal analysis or conclusions.\n---\n${input.textSample.slice(0, MAX_PROMPT_CHARS)}`,
    );
    return { summary: summary.trim().slice(0, 2000) };
  }

  async semanticSearch(input: { query: string; candidateTitles: string[] }): Promise<number[]> {
    if (input.candidateTitles.length === 0) return [];
    const [q, ...docs] = await this.embeddings.embed([input.query, ...input.candidateTitles]);
    return docs.map((d) => Math.max(0, cosineSimilarity(q, d)));
  }

  async interpretSearchQuery(input: { query: string }): Promise<SearchQueryInterpretation> {
    const out = await this.generateJson(
      `Interpret this legal document search query. Extract search keywords, intended document types (from: ${DOCUMENT_CLASSIFICATION_TYPES.join(", ")}), case numbers (CASE-YYYY-NNNNN), evidence numbers (EVD-YYYY-NNNNN) and an optional date range (YYYY-MM-DD). Query: ${JSON.stringify(input.query.slice(0, 500))}`,
      {
        type: "OBJECT",
        properties: {
          keywords: { type: "ARRAY", items: { type: "STRING" } },
          documentTypes: { type: "ARRAY", items: { type: "STRING", enum: [...DOCUMENT_CLASSIFICATION_TYPES] } },
          caseNumbers: { type: "ARRAY", items: { type: "STRING" } },
          evidenceNumbers: { type: "ARRAY", items: { type: "STRING" } },
          dateFrom: { type: "STRING", nullable: true },
          dateTo: { type: "STRING", nullable: true },
        },
      },
    );
    const inQuery = (v: string) => input.query.toUpperCase().includes(v.toUpperCase());
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()) : []);
    return {
      keywords: strings(out?.keywords).map((k) => k.toLowerCase()).slice(0, 12),
      documentTypes: strings(out?.documentTypes).filter((t): t is DocumentClassificationType => (DOCUMENT_CLASSIFICATION_TYPES as readonly string[]).includes(t)),
      caseNumbers: strings(out?.caseNumbers).filter(inQuery).map((v) => v.toUpperCase()),
      evidenceNumbers: strings(out?.evidenceNumbers).filter(inQuery).map((v) => v.toUpperCase()),
      dateFrom: normalizeDate(str(out?.dateFrom) ?? "") ?? undefined,
      dateTo: normalizeDate(str(out?.dateTo) ?? "") ?? undefined,
    };
  }
}

/** Validates model-returned metadata against the source text. Exported for tests. */
export function validateMetadata(out: any, sourceText: string): StructuredDocumentMetadata {
  const upperSource = sourceText.toUpperCase();
  const present = (v: string) => upperSource.includes(v.toUpperCase());
  const field = <T>(value: T | null, raw: any): MetadataValue<T> =>
    value === null || (Array.isArray(value) && value.length === 0) ? { value: null, confidence: 0 } : { value, confidence: clamp01(raw?.confidence) };

  const s = (key: string, mustBePresent = false) => {
    const v = str(out?.[key]?.value);
    return field(v && (!mustBePresent || present(v)) ? v.slice(0, 200) : null, out?.[key]);
  };
  const list = (key: string, mustBePresent: boolean) => {
    const raw = out?.[key]?.value;
    const values = Array.isArray(raw) ? raw.filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0).map((x: string) => x.trim()) : [];
    return field(values.filter((v: string) => !mustBePresent || present(v)).slice(0, 20), out?.[key]);
  };
  const pairs = <K extends string>(key: string, a: K, b: K) => {
    const raw = out?.[key]?.value;
    const values = (Array.isArray(raw) ? raw : [])
      .filter((x: any) => str(x?.[a]) && str(x?.[b]) && present(String(x[b])))
      .map((x: any) => ({ [a]: str(x[a])!, [b]: str(x[b])! }) as Record<K, string>)
      .slice(0, 10);
    return field(values, out?.[key]);
  };
  const docType = str(out?.documentType?.value);
  const date = normalizeDate(str(out?.documentDate?.value) ?? "");

  return {
    caseNumber: s("caseNumber", true),
    documentDate: field(date, out?.documentDate),
    documentTitle: s("documentTitle"),
    documentType: field(docType && (DOCUMENT_CLASSIFICATION_TYPES as readonly string[]).includes(docType) ? (docType as DocumentClassificationType) : null, out?.documentType),
    author: s("author", true),
    department: s("department", true),
    evidenceIds: list("evidenceIds", true),
    parties: pairs("parties", "role", "name") as MetadataValue<{ role: string; name: string }[]>,
    identifiers: pairs("identifiers", "label", "value") as MetadataValue<{ label: string; value: string }[]>,
    tags: list("tags", false),
  };
}
