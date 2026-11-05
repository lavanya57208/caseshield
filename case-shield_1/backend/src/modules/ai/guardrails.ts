// Output guardrails applied to EVERY provider's summary (mock or Vertex),
// see docs/ai-architecture.md §Guardrails. AI output in Case Shield is
// assistive: it must not state legal conclusions (guilt, innocence,
// liability, sentencing) or give legal advice. A sentence that asserts one
// is dropped unless it is a verbatim quotation of the source document (e.g.
// an extractive summary of a judgment restating the court's own words).

const LEGAL_CONCLUSION_PATTERNS: RegExp[] = [
  /\b(?:is|are|was|were|appears to be|seems to be|likely|clearly)\s+(?:not\s+)?(?:guilty|innocent|culpable|liable)\b/i,
  /\bshould\s+be\s+(?:convicted|acquitted|punished|sentenced|released|arrested|charged|discharged)\b/i,
  /\b(?:i|we)\s+(?:recommend|advise|conclude)\b/i,
  /\blegal advice\b/i,
  /\b(?:beyond (?:a )?reasonable doubt|proves? (?:that )?the accused)\b/i,
];

export const AI_OUTPUT_DISCLAIMER =
  "AI-generated, non-authoritative. Based only on the document's extracted text. Not legal advice and not a legal determination.";

export function containsLegalConclusion(sentence: string): boolean {
  return LEGAL_CONCLUSION_PATTERNS.some((re) => re.test(sentence));
}

export function applySummaryGuardrails(summary: string, sourceText: string): { summary: string; removedSentences: number } {
  const normalizedSource = sourceText.replace(/\s+/g, " ").toLowerCase();
  const sentences = summary.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => !containsLegalConclusion(s) || normalizedSource.includes(s.replace(/\s+/g, " ").toLowerCase().trim()));
  return { summary: kept.join(" ").trim(), removedSentences: sentences.length - kept.length };
}
