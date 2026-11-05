import {
  ClassificationResult,
  DocumentClassificationType,
  MetadataValue,
  SearchQueryInterpretation,
  StructuredDocumentMetadata,
} from "@/modules/ai/ai-provider.types";

// Deterministic, offline heuristics behind the MockAIProvider. They are
// deliberately conservative: a field that is not clearly present is
// returned as { value: null, confidence: 0 } rather than guessed, and every
// confidence is a heuristic score, not a calibrated probability.

type Cue = { pattern: RegExp; weight: number; name: string };

const cue = (name: string, pattern: RegExp, weight: number): Cue => ({ name, pattern, weight });

export const CLASSIFICATION_CUES: Record<Exclude<DocumentClassificationType, "OTHER">, Cue[]> = {
  FIR: [
    cue("first information report", /first information report/i, 3),
    cue("FIR", /\bfirs?\b/i, 2),
    cue("cognizable offence", /cogni[sz]able/i, 1),
  ],
  POLICE_REPORT: [
    cue("police report", /police report/i, 3),
    cue("incident report", /incident report/i, 2),
    cue("general diary", /general diary|daily diary|station diary/i, 1.5),
  ],
  WITNESS_STATEMENT: [
    cue("witness statement", /witness statement|statement of (?:the )?witness/i, 3),
    cue("witness", /\bwitness(?:es)?\b/i, 1),
    cue("testimony", /testimony|deposition/i, 1.5),
    cue("stated that", /stated that|states that/i, 1),
  ],
  CHARGE_SHEET: [
    cue("charge sheet", /charge ?sheet/i, 3),
    cue("final report", /final report/i, 1.5),
    cue("accused", /\baccused\b/i, 0.5),
  ],
  COURT_FILING: [
    cue("petition", /\bpetition(?:er)?\b/i, 2),
    cue("affidavit", /affidavit/i, 2),
    cue("in the court of", /in the court of/i, 2),
    cue("application under", /application under/i, 1.5),
    cue("respondent", /\brespondent\b/i, 1),
  ],
  FORENSIC_REPORT: [
    cue("forensic", /forensic/i, 2.5),
    cue("laboratory", /laborator(?:y|ies)|\blab report\b/i, 1.5),
    cue("ballistics/toxicology", /ballistic|toxicolog/i, 2),
    cue("device imaging", /\bimag(?:ed|ing)\b|hash value|write[- ]blocker/i, 1),
  ],
  LEGAL_NOTICE: [
    cue("legal notice", /legal notice/i, 3),
    cue("notice is hereby", /notice is hereby|take notice/i, 2),
    cue("summons", /\bsummons\b/i, 2),
  ],
  JUDGMENT: [
    cue("judgment", /judge?ment/i, 3),
    cue("order of the court", /order of the court|it is (?:hereby )?ordered/i, 2),
    cue("pronounced", /pronounced|decree/i, 1.5),
  ],
  EVIDENCE_RECORD: [
    cue("evidence record", /evidence record|evidence register/i, 3),
    cue("seizure memo", /seizure memo|seizure list/i, 2.5),
    cue("evidence number", /\bEVD-\d{4}-\d{3,6}\b/i, 1.5),
    cue("chain of custody", /chain of custody|exhibit/i, 1.5),
  ],
  INVESTIGATION_RECORD: [
    cue("investigation report", /investigation (?:report|record)/i, 3),
    cue("case diary", /case diary/i, 2.5),
    cue("investigative steps", /investigative steps|line of investigation/i, 1.5),
  ],
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function classifyText(fileName: string, text: string): ClassificationResult {
  const scores: { type: DocumentClassificationType; score: number; matched: string[] }[] = [];
  const title = fileName.replace(/[_-]+/g, " ");
  for (const [type, cues] of Object.entries(CLASSIFICATION_CUES) as [DocumentClassificationType, Cue[]][]) {
    let score = 0;
    const matched: string[] = [];
    for (const c of cues) {
      // A cue in the file name/title counts extra; each cue counts once.
      const inTitle = c.pattern.test(title);
      const inText = c.pattern.test(text);
      if (inTitle || inText) {
        score += c.weight * (inTitle ? 1.5 : 1);
        matched.push(c.name);
      }
    }
    scores.push({ type, score, matched });
  }
  scores.sort((a, b) => b.score - a.score);
  const [top, second] = scores;
  if (!top || top.score < 1.5) {
    return { suggestedType: "OTHER", confidence: 0.3, rationale: "No strong document-type cues were found." };
  }
  const margin = (top.score - (second?.score ?? 0)) / top.score;
  const confidence = Math.min(0.95, Math.max(0.4, 0.45 + 0.05 * top.score + 0.25 * margin));
  return { suggestedType: top.type, confidence: round2(confidence), rationale: `Matched cues: ${top.matched.join(", ")}` };
}

// --- Metadata ---------------------------------------------------------------

const none = <T>(): MetadataValue<T> => ({ value: null, confidence: 0 });
const found = <T>(value: T, confidence: number): MetadataValue<T> => ({ value, confidence: round2(confidence) });

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Normalizes yyyy-mm-dd, dd/mm/yyyy (Indian day-first) and "12 September 2026" to ISO; null if invalid. */
export function normalizeDate(raw: string): string | null {
  let y: number, m: number, d: number;
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = raw.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/i))) {
    d = Number(match[1]);
    m = MONTHS.indexOf(match[2].toLowerCase()) + 1;
    y = Number(match[3]);
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return date.toISOString().slice(0, 10);
}

const DATE_TOKEN = String.raw`(\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4})`;
const LABELED_DATE = new RegExp(String.raw`\b(?:date(?: of (?:report|incident|filing|statement))?|dated|report date|filed on|recorded on)\s*[:\-]?\s*` + DATE_TOKEN, "i");
const ANY_DATE = new RegExp(DATE_TOKEN);

function labeled(text: string, labels: string): string | null {
  const re = new RegExp(String.raw`(?:^|\n)\s*(?:${labels})\s*[:\-]\s*([^\n]{2,80})`, "i");
  const m = text.match(re);
  const value = m?.[1]?.trim().replace(/[.;,]+$/, "");
  return value && value.length >= 2 ? value : null;
}

const TAG_VOCABULARY: Record<string, RegExp> = {
  cybercrime: /cyber|unauthori[sz]ed access|phishing|malware|hacking/i,
  fraud: /fraud|cheating|forgery|embezzlement/i,
  theft: /\btheft\b|stolen|burglary|robbery/i,
  assault: /assault|grievous hurt|injur(?:y|ies)/i,
  "digital-evidence": /digital evidence|hard disk|mobile (?:phone|handset)|device|imag(?:ed|ing)|hash value/i,
  narcotics: /narcotic|ndps|contraband/i,
  property: /property|land|encroachment|boundary/i,
  "motor-accident": /motor accident|vehicle collision|road accident/i,
};

export function extractStructuredMetadata(fileName: string, text: string, documentType: DocumentClassificationType, typeConfidence: number): StructuredDocumentMetadata {
  const caseMatch = text.match(/\bCASE-\d{4}-\d{3,6}\b/i) ?? fileName.match(/\bCASE-\d{4}-\d{3,6}\b/i);
  const caseLabeled = /\bcase(?:\s*(?:no\.?|number))?\s*[:\-]\s*CASE-\d{4}-\d{3,6}/i.test(text);

  const labeledDate = text.match(LABELED_DATE);
  const anyDate = labeledDate ? null : text.match(ANY_DATE);
  const isoDate = normalizeDate((labeledDate?.[1] ?? anyDate?.[1] ?? "").trim());

  const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  const titleLike = firstLine.length >= 6 && firstLine.length <= 120 && /[A-Za-z]/.test(firstLine) && firstLine === firstLine.toUpperCase();

  const author = labeled(text, "prepared by|author|submitted by|recorded by|signed by|examined by|investigating officer|reporting officer");
  const department = labeled(text, "department|police station|unit|laboratory|division|court|agency");

  const evidenceIds = [...new Set((text.match(/\bEVD-\d{4}-\d{3,6}\b/gi) ?? []).map((v) => v.toUpperCase()))];

  const parties: { role: string; name: string }[] = [];
  const partyRe = /(?:^|\n)\s*(complainant|accused|witness|petitioner|respondent|victim|applicant|plaintiff|defendant)(?:\s+name)?\s*[:\-]\s*([^\n,;]{2,60})/gi;
  for (const m of text.matchAll(partyRe)) {
    parties.push({ role: m[1].toLowerCase(), name: m[2].trim() });
    if (parties.length >= 10) break;
  }

  const identifiers: { label: string; value: string }[] = [];
  const fir = text.match(/\bFIR\s*(?:No\.?|Number)\s*[:\-]?\s*([A-Z0-9][A-Z0-9/-]{1,29})/i);
  if (fir) identifiers.push({ label: "FIR number", value: fir[1] });
  for (const m of text.matchAll(/\bDOC-\d{4}-\d{3,6}\b/gi)) identifiers.push({ label: "Document number", value: m[0].toUpperCase() });
  const ref = text.match(/\b(?:lab(?:oratory)? ref(?:erence)?|reference|ref)\.?\s*(?:no\.?|number)?\s*[:\-]\s*([A-Z0-9][A-Z0-9/-]{2,29})/i);
  if (ref) identifiers.push({ label: "Reference number", value: ref[1] });
  const dedupedIdentifiers = identifiers.filter((v, i, all) => all.findIndex((o) => o.label === v.label && o.value === v.value) === i).slice(0, 10);

  const tags = Object.entries(TAG_VOCABULARY)
    .filter(([, re]) => re.test(text))
    .map(([tag]) => tag);

  return {
    caseNumber: caseMatch ? found(caseMatch[0].toUpperCase(), caseLabeled ? 0.9 : 0.75) : none(),
    documentDate: isoDate ? found(isoDate, labeledDate ? 0.85 : 0.55) : none(),
    documentTitle: titleLike ? found(firstLine, 0.6) : none(),
    documentType: documentType === "OTHER" ? none() : found(documentType, typeConfidence),
    author: author ? found(author, 0.7) : none(),
    department: department ? found(department, 0.7) : none(),
    evidenceIds: evidenceIds.length ? found(evidenceIds, 0.9) : none(),
    parties: parties.length ? found(parties, 0.6) : none(),
    identifiers: dedupedIdentifiers.length ? found(dedupedIdentifiers, 0.8) : none(),
    tags: tags.length ? found(tags, 0.5) : none(),
  };
}

/** Flattens metadata values into plain text for the search index (weight A). */
export function metadataToSearchText(meta: Partial<StructuredDocumentMetadata> | null | undefined): string {
  if (!meta) return "";
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) v.forEach(push);
    else if (typeof v === "object") Object.values(v as Record<string, unknown>).forEach(push);
    else parts.push(String(v));
  };
  for (const field of Object.values(meta)) push((field as MetadataValue<unknown> | undefined)?.value);
  return parts.join(" ").slice(0, 5000);
}

// --- Summary ----------------------------------------------------------------

/** Extractive summary: the first few informative sentences, verbatim from the (masked) text. */
// Abbreviations whose trailing period does not end a sentence.
const ABBREVIATION = /\b(?:No|Nos|Sec|Cr|P\.C|Mr|Mrs|Ms|Dr|Smt|Sh|Shri|vs|Ref|Dt|Insp|SI|ASI|Hon|Ld)\.$/i;

function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.replace(/\r/g, "").split(/\n+/)) {
    let current = "";
    for (const part of line.split(/(?<=[.!?])\s+/)) {
      current = current ? `${current} ${part}` : part;
      if (!ABBREVIATION.test(current)) {
        out.push(current.trim());
        current = "";
      }
    }
    if (current.trim()) out.push(current.trim());
  }
  return out.filter(Boolean);
}

/** A form header ("Police Station: X", an ALL-CAPS title) rather than narrative prose. */
function isHeaderLike(s: string) {
  if (s === s.toUpperCase()) return true;
  const colon = s.indexOf(":");
  return colon > 0 && colon <= 40 && s.split(/\s+/).length <= 12;
}

export function extractiveSummary(text: string, maxSentences = 3, maxChars = 600): string {
  const candidates = splitSentences(text).filter((s) => s.length >= 25 && /[a-z]/.test(s));
  // Prefer narrative sentences; fall back to header lines only if there is nothing else.
  const prose = candidates.filter((s) => !isHeaderLike(s) && s.split(/\s+/).length >= 6);
  const sentences = prose.length ? prose : candidates;
  const picked: string[] = [];
  let length = 0;
  for (const s of sentences) {
    if (picked.length >= maxSentences || length + s.length > maxChars) break;
    picked.push(/[.!?]$/.test(s) ? s : `${s}.`);
    length += s.length + 1;
  }
  return picked.join(" ");
}

// --- Search query interpretation ---------------------------------------------

const STOPWORDS = new Set(
  "a an and any are about all as at be by for from has have in into is it its of on or show find me get list documents document docs file files the their there these this those to with within related regarding concerning which who what where when".split(
    " ",
  ),
);

export function interpretQuery(query: string): SearchQueryInterpretation {
  const q = query.trim();
  const caseNumbers = [...new Set((q.match(/\bCASE-\d{4}-\d{3,6}\b/gi) ?? []).map((v) => v.toUpperCase()))];
  const evidenceNumbers = [...new Set((q.match(/\bEVD-\d{4}-\d{3,6}\b/gi) ?? []).map((v) => v.toUpperCase()))];

  const documentTypes: DocumentClassificationType[] = [];
  for (const [type, cues] of Object.entries(CLASSIFICATION_CUES) as [DocumentClassificationType, Cue[]][]) {
    if (cues.some((c) => c.weight >= 2 && c.pattern.test(q))) documentTypes.push(type);
  }

  let dateFrom: string | undefined;
  let dateTo: string | undefined;
  const after = q.match(/\b(?:after|since|from)\s+(\d{4}-\d{2}-\d{2})/i);
  const before = q.match(/\b(?:before|until|till|to)\s+(\d{4}-\d{2}-\d{2})/i);
  if (after) dateFrom = normalizeDate(after[1]) ?? undefined;
  if (before) dateTo = normalizeDate(before[1]) ?? undefined;

  const keywords = [
    ...new Set(
      q
        .replace(/\bCASE-\d{4}-\d{3,6}\b|\bEVD-\d{4}-\d{3,6}\b|\d{4}-\d{2}-\d{2}/gi, " ")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !["after", "since", "before", "until", "till"].includes(w)),
    ),
  ].slice(0, 12);

  return { keywords, documentTypes, caseNumbers, evidenceNumbers, dateFrom, dateTo };
}
