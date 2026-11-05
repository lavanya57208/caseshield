import { describe, it, expect } from "vitest";
import { classifyText, extractStructuredMetadata, extractiveSummary, interpretQuery, metadataToSearchText, normalizeDate } from "../../backend/src/modules/ai/heuristics";
import { applySummaryGuardrails, containsLegalConclusion } from "../../backend/src/modules/ai/guardrails";
import { MockAIProvider } from "../../backend/src/modules/ai/mock-ai.provider";
import { VertexAIProvider, validateMetadata } from "../../backend/src/modules/ai/vertex-ai.provider";
import { env } from "../../backend/src/config/env";
import { MockOCRProvider } from "../../backend/src/modules/ai/ocr/mock-ocr.provider";
import { DocumentAIOCRProvider, parseDocumentAiResponse } from "../../backend/src/modules/ai/ocr/document-ai-ocr.provider";
import { summarizePages } from "../../backend/src/modules/ai/ocr/ocr-provider.types";
import { MockEmbeddingProvider, cosineSimilarity } from "../../backend/src/modules/ai/embeddings";
import { buildScannedJpeg, buildScannedPdf, buildScannedPng, scannedFirText, scannedWitnessText } from "../../prisma/fixtures/ocr-fixtures";

// Phase 4 unit tests: deterministic heuristics, guardrails, OCR adapters and
// embeddings. No database, no network. All document text is fictional.

describe("classification heuristics", () => {
  it("classifies an FIR and a witness statement with explained cues", () => {
    const fir = classifyText("scan.pdf", scannedFirText());
    expect(fir.suggestedType).toBe("FIR");
    expect(fir.confidence).toBeGreaterThan(0.5);
    expect(fir.rationale).toMatch(/first information report/);

    expect(classifyText("statement.pdf", scannedWitnessText()).suggestedType).toBe("WITNESS_STATEMENT");
  });

  it("returns OTHER with low confidence when nothing matches, instead of guessing", () => {
    const r = classifyText("notes.txt", "Shopping list: bread, rice, tea.");
    expect(r.suggestedType).toBe("OTHER");
    expect(r.confidence).toBeLessThan(0.5);
  });
});

describe("metadata extraction heuristics", () => {
  it("extracts labeled values and leaves missing fields null (never guessed)", () => {
    const text = scannedFirText("CASE-2024-00042");
    const m = extractStructuredMetadata("fir.pdf", text, "FIR", 0.8);
    expect(m.caseNumber.value).toBe("CASE-2024-00042");
    expect(m.documentDate.value).toBe("2024-03-12");
    expect(m.author.value).toBe("SI Demo Kumar");
    expect(m.department.value).toMatch(/Demo Nagar Police Station/);
    expect(m.identifiers.value).toContainEqual({ label: "FIR number", value: "0421/2024" });
    expect(m.tags.value).toContain("theft");
    expect(m.evidenceIds).toEqual({ value: null, confidence: 0 });
    expect(m.parties).toEqual({ value: null, confidence: 0 });
  });

  it("normalizes day-first Indian dates and rejects impossible ones", () => {
    expect(normalizeDate("05/09/2026")).toBe("2026-09-05");
    expect(normalizeDate("12 September 2026")).toBe("2026-09-12");
    expect(normalizeDate("31/02/2026")).toBeNull();
  });

  it("flattens metadata into search text", () => {
    const m = extractStructuredMetadata("fir.pdf", scannedFirText("CASE-2024-00042"), "FIR", 0.8);
    const text = metadataToSearchText(m);
    expect(text).toContain("CASE-2024-00042");
    expect(text).toContain("0421/2024");
  });

  it("Vertex output validation drops values that do not occur in the source text (anti-hallucination)", () => {
    const source = "FIR registered in CASE-2024-00042. Investigating Officer: SI Demo Kumar";
    const out = validateMetadata(
      {
        caseNumber: { value: "CASE-2024-00042", confidence: 0.9 },
        author: { value: "Inspector Invented Person", confidence: 0.9 },
        evidenceIds: { value: ["EVD-2024-99999"], confidence: 0.9 },
        documentType: { value: "NOT_A_TYPE", confidence: 0.9 },
      },
      source,
    );
    expect(out.caseNumber.value).toBe("CASE-2024-00042");
    expect(out.author.value).toBeNull();
    expect(out.evidenceIds.value ?? []).toEqual([]);
    expect(out.documentType.value).toBeNull();
  });
});

describe("summary + guardrails", () => {
  it("extractive summary takes informative sentences verbatim", () => {
    const s = extractiveSummary(scannedFirText());
    expect(s).toContain("two-wheeler was stolen");
  });

  it("drops generated legal conclusions but keeps verbatim quotations of the source", () => {
    expect(containsLegalConclusion("The accused is guilty of theft.")).toBe(true);
    const r = applySummaryGuardrails("A vehicle was reported stolen. The accused is clearly guilty. We recommend arrest.", "A vehicle was reported stolen.");
    expect(r.summary).toBe("A vehicle was reported stolen.");
    expect(r.removedSentences).toBe(2);

    const judgment = "The court held that the accused is not guilty.";
    expect(applySummaryGuardrails(judgment, `JUDGMENT. ${judgment}`).summary).toBe(judgment);
  });

  it("MockAIProvider returns structured metadata and a legacy entity view", async () => {
    const r = await new MockAIProvider().extractMetadata({ fileName: "fir.pdf", mimeType: "application/pdf", textSample: scannedFirText("CASE-2024-00042") });
    expect(r.documentType).toBe("FIR");
    expect(r.fields?.caseNumber.value).toBe("CASE-2024-00042");
    expect(r.entities.some((e) => e.label === "Referenced case number")).toBe(true);
  });
});

describe("search query interpretation", () => {
  it("extracts types, case/evidence numbers, date bounds and keywords", () => {
    const i = interpretQuery("witness statements in CASE-2024-00042 about EVD-2024-00007 after 2024-01-01 parking");
    expect(i.documentTypes).toContain("WITNESS_STATEMENT");
    expect(i.caseNumbers).toEqual(["CASE-2024-00042"]);
    expect(i.evidenceNumbers).toEqual(["EVD-2024-00007"]);
    expect(i.dateFrom).toBe("2024-01-01");
    expect(i.keywords).toContain("parking");
    expect(i.keywords).not.toContain("after");
  });
});

describe("OCR — mock provider", () => {
  const payload = { pages: [{ text: scannedFirText(), confidence: 0.93 }], language: "en" };
  const ocr = new MockOCRProvider();

  it("reads the fixture layer from PNG, JPEG and image-only PDF", async () => {
    for (const [buffer, mimeType] of [
      [buildScannedPng(payload), "image/png"],
      [buildScannedJpeg(payload), "image/jpeg"],
      [await buildScannedPdf(payload), "application/pdf"],
    ] as const) {
      const r = await ocr.extractText({ buffer, mimeType, fileName: "scan" });
      expect(r.status, mimeType).toBe("COMPLETED");
      expect(r.pages[0].text).toContain("FIRST INFORMATION REPORT");
      expect(r.confidence).toBe(0.93);
      expect(r.language).toBe("en");
      expect(r.limitations.join(" ")).toMatch(/fixture layer/);
    }
  });

  it("reports FAILED — never an empty success — for an image with no recognizable text", async () => {
    const r = await ocr.extractText({ buffer: buildScannedPng(), mimeType: "image/png", fileName: "blank.png" });
    expect(r.status).toBe("FAILED");
    expect(r.pages).toEqual([]);
    expect(r.error).toMatch(/No text could be recognized/);
  });

  it("reports PARTIAL when some PDF pages produced no text", async () => {
    const r = await ocr.extractText({ buffer: await buildScannedPdf(payload, 3), mimeType: "application/pdf", fileName: "scan.pdf" });
    expect(r.status).toBe("PARTIAL");
    expect(r.pages).toHaveLength(3);
    expect(r.limitations.join(" ")).toMatch(/2 of 3 page\(s\) produced no text/);
  });

  it("returns UNSUPPORTED for types it cannot handle", async () => {
    const r = await ocr.extractText({ buffer: Buffer.from("x"), mimeType: "image/tiff", fileName: "a.tiff" });
    expect(r.status).toBe("UNSUPPORTED");
  });

  it("summarizePages flags low-confidence pages as PARTIAL", () => {
    expect(summarizePages([{ pageNumber: 1, text: "hello", confidence: 0.3 }]).status).toBe("PARTIAL");
    expect(summarizePages([]).status).toBe("FAILED");
  });
});

describe("OCR — Google Document AI adapter (offline, injected transport)", () => {
  it("sends base64 content to the processor endpoint and parses pages, confidence and language", async () => {
    const calls: { url: string; body: any }[] = [];
    const text = "Page one text\nPage two text";
    const provider = new DocumentAIOCRProvider(async (url, body) => {
      calls.push({ url, body });
      return {
        document: {
          text,
          pages: [
            { pageNumber: 1, layout: { confidence: 0.98, textAnchor: { textSegments: [{ startIndex: 0, endIndex: 13 }] } }, detectedLanguages: [{ languageCode: "en", confidence: 0.99 }] },
            { pageNumber: 2, layout: { confidence: 0.9, textAnchor: { textSegments: [{ startIndex: "14", endIndex: "27" }] } } },
          ],
        },
      };
    });
    // endpoint() reads env lazily; stub it so the test does not depend on .env.
    (provider as any).endpoint = () => "https://us-documentai.googleapis.com/v1/projects/demo-project/locations/us/processors/p1:process";
    const r = await provider.extractText({ buffer: Buffer.from("%PDF-1.7 fake"), mimeType: "application/pdf", fileName: "scan.pdf" });
    expect(calls[0].url).toMatch(/processors\/p1:process$/);
    expect(calls[0].body.rawDocument).toEqual({ content: Buffer.from("%PDF-1.7 fake").toString("base64"), mimeType: "application/pdf" });
    expect(r.status).toBe("COMPLETED");
    expect(r.pages.map((p) => p.text)).toEqual(["Page one text", "Page two text"]);
    expect(r.confidence).toBe(0.94);
    expect(r.language).toBe("en");
  });

  it("maps an empty response to FAILED and rejects unsupported types without calling the API", async () => {
    expect(parseDocumentAiResponse({ document: { text: "", pages: [] } }).status).toBe("FAILED");
    let called = false;
    const provider = new DocumentAIOCRProvider(async () => {
      called = true;
    });
    const r = await provider.extractText({ buffer: Buffer.from("x"), mimeType: "audio/mpeg", fileName: "a.mp3" });
    expect(r.status).toBe("UNSUPPORTED");
    expect(called).toBe(false);
  });
});

describe("embeddings", () => {
  it("mock embeddings are deterministic, normalized, and rank related text higher", async () => {
    const e = new MockEmbeddingProvider();
    const [q, related, unrelated] = await e.embed(["stolen two-wheeler parking", "A two-wheeler was stolen from the parking area", "Judgment on a land boundary dispute"]);
    expect(Math.hypot(...q)).toBeCloseTo(1, 5);
    expect(cosineSimilarity(q, related)).toBeGreaterThan(cosineSimilarity(q, unrelated));
    const [again] = await e.embed(["stolen two-wheeler parking"]);
    expect(again).toEqual(q);
  });
});

describe("Vertex AI adapter (offline, injected transport)", () => {
  const withProject = async (fn: () => Promise<void>) => {
    const saved = [env.GOOGLE_CLOUD_PROJECT_ID, env.GOOGLE_CLOUD_REGION];
    env.GOOGLE_CLOUD_PROJECT_ID = "demo-project";
    env.GOOGLE_CLOUD_REGION = "asia-south1";
    try {
      await fn();
    } finally {
      [env.GOOGLE_CLOUD_PROJECT_ID, env.GOOGLE_CLOUD_REGION] = saved;
    }
  };
  const reply = (obj: unknown) => ({ candidates: [{ content: { parts: [{ text: typeof obj === "string" ? obj : JSON.stringify(obj) }] } }] });

  it("calls generateContent deterministically with the guardrail system instruction and validates the classification", async () =>
    withProject(async () => {
      const calls: { url: string; body: any }[] = [];
      const provider = new VertexAIProvider(async (url, body) => {
        calls.push({ url, body });
        return reply({ suggestedType: "NOT_IN_TAXONOMY", confidence: 0.99 });
      });
      const r = await provider.classifyDocument({ fileName: "x.pdf", textSample: "Some masked text" });
      expect(calls[0].url).toMatch(/asia-south1-aiplatform\.googleapis\.com\/v1\/projects\/demo-project\/.*:generateContent$/);
      expect(calls[0].body.generationConfig).toMatchObject({ temperature: 0, responseMimeType: "application/json" });
      expect(calls[0].body.systemInstruction.parts[0].text).toMatch(/Never state or imply guilt/);
      // Out-of-taxonomy output is coerced to OTHER with capped confidence.
      expect(r).toMatchObject({ suggestedType: "OTHER" });
      expect(r.confidence).toBeLessThanOrEqual(0.5);
    }));

  it("keeps only case/evidence numbers that occur in the query when interpreting search", async () =>
    withProject(async () => {
      const provider = new VertexAIProvider(async () =>
        reply({ keywords: ["Theft"], documentTypes: ["FIR", "BOGUS"], caseNumbers: ["CASE-2024-00042", "CASE-2099-99999"], evidenceNumbers: [], dateFrom: "01/02/2024" }),
      );
      const r = await provider.interpretSearchQuery({ query: "theft FIRs in case-2024-00042" });
      expect(r).toMatchObject({ keywords: ["theft"], documentTypes: ["FIR"], caseNumbers: ["CASE-2024-00042"], dateFrom: "2024-02-01" });
    }));

  it("surfaces malformed or empty model output as an error (the pipeline records a FAILED step)", async () =>
    withProject(async () => {
      await expect(new VertexAIProvider(async () => reply("not json")).classifyDocument({ fileName: "x", textSample: "t" })).rejects.toThrow(/malformed JSON/);
      await expect(new VertexAIProvider(async () => ({ candidates: [] })).summarizeDocument({ textSample: "t" })).rejects.toThrow(/empty response/);
    }));
});
