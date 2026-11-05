import {
  AIProvider,
  ClassificationResult,
  DocumentClassificationType,
  ExtractedField,
  MetadataExtractionResult,
  SearchQueryInterpretation,
  SummaryResult,
} from "@/modules/ai/ai-provider.types";
import { classifyText, extractStructuredMetadata, extractiveSummary, interpretQuery } from "@/modules/ai/heuristics";

// DEVELOPMENT ADAPTER — deterministic, offline, no network calls.
// Approximates classification / metadata extraction / summarization with
// transparent keyword and pattern heuristics (see heuristics.ts) so the
// demo and tests are reproducible without any AI provider credentials.
// Production swaps this for Vertex AI behind the identical interface.
export class MockAIProvider implements AIProvider {
  readonly name = "MockAIProvider (development, heuristic, offline)";

  async extractMetadata(input: { fileName: string; mimeType: string; textSample: string }): Promise<MetadataExtractionResult> {
    const classification = classifyText(input.fileName, input.textSample);
    const type = classification.suggestedType as DocumentClassificationType;
    const fields = extractStructuredMetadata(input.fileName, input.textSample, type, classification.confidence);

    // Legacy flat view, kept for the pre-Phase 4 /api/ai/extract-metadata consumers.
    const entities: ExtractedField[] = [{ label: "Suggested document type", value: type, confidence: classification.confidence }];
    if (fields.caseNumber.value) entities.push({ label: "Referenced case number", value: fields.caseNumber.value, confidence: fields.caseNumber.confidence });
    if (fields.documentDate.value) entities.push({ label: "Referenced date", value: fields.documentDate.value, confidence: fields.documentDate.confidence });
    if (fields.author.value) entities.push({ label: "Author", value: fields.author.value, confidence: fields.author.confidence });
    if (fields.department.value) entities.push({ label: "Department", value: fields.department.value, confidence: fields.department.confidence });
    for (const id of fields.evidenceIds.value ?? []) entities.push({ label: "Evidence ID", value: id, confidence: fields.evidenceIds.confidence });

    return {
      documentType: type,
      suggestedCaseNumber: fields.caseNumber.value ?? undefined,
      entities,
      fields,
      extractedAt: new Date().toISOString(),
    };
  }

  async classifyDocument(input: { fileName: string; textSample: string }): Promise<ClassificationResult> {
    return classifyText(input.fileName, input.textSample);
  }

  async summarizeDocument(input: { textSample: string }): Promise<SummaryResult> {
    const summary = extractiveSummary(input.textSample);
    return { summary: summary || "No extractable text content was available to summarize." };
  }

  async semanticSearch(input: { query: string; candidateTitles: string[] }): Promise<number[]> {
    const q = input.query.toLowerCase();
    return input.candidateTitles.map((title) => {
      const t = title.toLowerCase();
      if (t.includes(q)) return 1;
      const overlap = q.split(/\s+/).filter((word) => word.length > 2 && t.includes(word)).length;
      return Math.min(1, overlap * 0.3);
    });
  }

  async interpretSearchQuery(input: { query: string }): Promise<SearchQueryInterpretation> {
    return interpretQuery(input.query);
  }
}
