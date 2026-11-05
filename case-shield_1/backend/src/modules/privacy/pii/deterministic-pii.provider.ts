import {
  AddressDetectionStrategy,
  PiiConfidence,
  PiiCoverage,
  PiiDetection,
  PiiDetectionProvider,
  PiiTextPage,
  PiiType,
} from "@/modules/privacy/pii/pii.types";
import { verhoeffValidate } from "@/modules/privacy/pii/verhoeff";
import { maskAadhaar, maskAddress, maskEmail, maskIpv4, maskPhone } from "@/modules/privacy/pii/masking";

// DEVELOPMENT / BASELINE PROVIDER — deterministic, rule-based PII
// detection. It runs fully offline and is predictable, but it is NOT
// complete: it only finds the patterns below, can miss values written in
// unusual formats, and can flag numbers that merely look like PII. Every
// detection carries a confidence level and is reviewed by a human before
// anything is redacted. See docs/security-architecture.md §PII Protection.

const CONTEXT_WINDOW = 40;

function contextBefore(text: string, index: number, window = CONTEXT_WINDOW): string {
  return text.slice(Math.max(0, index - window), index);
}

function around(text: string, start: number, end: number, window = CONTEXT_WINDOW): string {
  return text.slice(Math.max(0, start - window), Math.min(text.length, end + window));
}

const AADHAAR_CONTEXT = /aadhaa?r|uidai|\buid\b|आधार/i;
const PHONE_CONTEXT = /phone|mobile|\bmob\b|\btel\b|contact|\bph\b|whats\s?app|\bcall\b/i;
const IP_CONTEXT = /\bip\b|ip\s*address|ipv4|host|server|login|logged|source|remote/i;
const VERSION_CONTEXT = /\bv(?:ersion)?\s*\.?$/i;

function confidenceFrom(score: number): PiiConfidence {
  return score >= 2 ? "HIGH" : score === 1 ? "MEDIUM" : "LOW";
}

function detectAadhaar(page: PiiTextPage): PiiDetection[] {
  const out: PiiDetection[] = [];
  // 12 digits, first digit 2-9 (Aadhaar numbers never start with 0/1),
  // either contiguous or grouped 4-4-4 with a consistent separator.
  const re = /(?<![\d+\-./])([2-9]\d{3})([ -]?)(\d{4})\2(\d{4})(?![\d\-/]|\.\d)/g;
  for (const m of page.text.matchAll(re)) {
    const start = m.index!;
    const end = start + m[0].length;
    const digits = m[1] + m[3] + m[4];
    const checksum = verhoeffValidate(digits);
    const keyword = AADHAAR_CONTEXT.test(contextBefore(page.text, start));
    out.push({
      type: "AADHAAR_LIKE",
      confidence: confidenceFrom((checksum ? 1 : 0) + (keyword ? 1 : 0)),
      pageNumber: page.pageNumber,
      start,
      end,
      maskedPreview: maskAadhaar(digits),
      detectionMethod: `pattern:12-digit${checksum ? "+verhoeff" : ""}${keyword ? "+context" : ""}`,
      value: m[0],
      normalized: digits,
    });
  }
  return out;
}

function detectPhones(page: PiiTextPage): PiiDetection[] {
  const out: PiiDetection[] = [];
  // Optional +91 / 0091 / 0 prefix, then a 10-digit mobile number starting
  // 6-9, allowing single spaces/hyphens between digits (e.g. 98765 43210,
  // 987-654-3210). Candidates are post-validated below.
  const re = /(?<![\w+])((?:\+|00)91[\s-]?|0)?([6-9](?:[ -]?\d){9})(?![\w]|[ -]\d)/g;
  for (const m of page.text.matchAll(re)) {
    const body = m[2];
    const separators = (body.match(/[ -]/g) ?? []).length;
    if (separators > 3) continue;
    const digits = body.replace(/\D/g, "");
    if (digits.length !== 10) continue;
    const start = m.index!;
    const end = start + m[0].length;
    const intlPrefix = !!m[1] && m[1].trim() !== "0";
    const keyword = PHONE_CONTEXT.test(contextBefore(page.text, start, 30));
    out.push({
      type: "PHONE_NUMBER",
      confidence: confidenceFrom(1 + (intlPrefix || keyword ? 1 : 0)),
      pageNumber: page.pageNumber,
      start,
      end,
      maskedPreview: maskPhone(digits),
      detectionMethod: `pattern:in-mobile${intlPrefix ? "+country-code" : ""}${keyword ? "+context" : ""}`,
      value: m[0],
      normalized: digits,
    });
  }
  return out;
}

function detectEmails(page: PiiTextPage): PiiDetection[] {
  const out: PiiDetection[] = [];
  const re = /(?<![\w.%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}(?![\w-])/g;
  for (const m of page.text.matchAll(re)) {
    const start = m.index!;
    out.push({
      type: "EMAIL_ADDRESS",
      confidence: "HIGH",
      pageNumber: page.pageNumber,
      start,
      end: start + m[0].length,
      maskedPreview: maskEmail(m[0]),
      detectionMethod: "pattern:rfc5322-subset",
      value: m[0],
      normalized: m[0].toLowerCase(),
    });
  }
  return out;
}

function detectIpv4(page: PiiTextPage): PiiDetection[] {
  const out: PiiDetection[] = [];
  const octet = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
  const re = new RegExp(`(?<![\\d.])(?:${octet}\\.){3}${octet}(?!\\d|\\.\\d)`, "g");
  for (const m of page.text.matchAll(re)) {
    const start = m.index!;
    const end = start + m[0].length;
    const before = contextBefore(page.text, start, 12);
    const looksLikeVersion = VERSION_CONTEXT.test(before);
    const keyword = IP_CONTEXT.test(around(page.text, start, end, 30));
    out.push({
      type: "IP_ADDRESS",
      confidence: looksLikeVersion ? "LOW" : keyword ? "HIGH" : "MEDIUM",
      pageNumber: page.pageNumber,
      start,
      end,
      maskedPreview: maskIpv4(m[0]),
      detectionMethod: `pattern:ipv4${keyword ? "+context" : ""}${looksLikeVersion ? "+version-like" : ""}`,
      value: m[0],
      normalized: m[0],
    });
  }
  return out;
}

const ADDRESS_LABEL = /\b(?:address|addr\.?|residing at|resident of|r\/o|permanent address|present address)\b/i;
const ADDRESS_KEYWORDS =
  /\b(?:road|rd\.?|street|st\.|lane|marg|nagar|colony|sector|block|flat|house no\.?|h\.?\s?no\.?|plot|apartment|apts?\.?|floor|layout|cross|main|village|taluk|tehsil|district|near|opp\.?|behind|landmark|pin(?:\s*code)?)\b/gi;
const PIN_CODE = /(?<!\d)([1-9]\d{2})\s?(\d{3})(?!\d)/;

/**
 * LIMITED heuristic address detection: flags single lines that combine
 * address vocabulary with a 6-digit PIN code or an explicit "Address:"
 * label. It will miss multi-line or free-form addresses and may flag
 * non-address lines. Marked `limited` so the UI and scan metadata say so.
 */
export class HeuristicAddressDetection implements AddressDetectionStrategy {
  readonly name = "heuristic-address-v1";
  readonly limited = true;

  detect(page: PiiTextPage): PiiDetection[] {
    const out: PiiDetection[] = [];
    let lineStart = 0;
    for (const line of page.text.split("\n")) {
      const lineEnd = lineStart + line.length;
      const keywordHits = (line.match(ADDRESS_KEYWORDS) ?? []).length;
      const labelMatch = ADDRESS_LABEL.exec(line);
      const pin = PIN_CODE.exec(line);
      const score = (labelMatch ? 1 : 0) + (pin ? 1 : 0) + (keywordHits >= 2 ? 1 : 0);
      const qualifies = (labelMatch && (pin || keywordHits >= 1)) || (pin && keywordHits >= 1);
      if (qualifies) {
        // Start after an "Address:" style label when present, so the label
        // itself stays readable in the redacted copy.
        let spanStart = lineStart;
        if (labelMatch) {
          const afterLabel = line.slice(labelMatch.index + labelMatch[0].length);
          const lead = afterLabel.match(/^[\s:–—-]*/)?.[0].length ?? 0;
          spanStart = lineStart + labelMatch.index + labelMatch[0].length + lead;
        } else {
          spanStart = lineStart + (line.length - line.trimStart().length);
        }
        const spanEnd = lineStart + line.trimEnd().length;
        if (spanEnd > spanStart) {
          const value = page.text.slice(spanStart, spanEnd);
          const pinCode = pin ? pin[1] + pin[2] : undefined;
          out.push({
            type: "ADDRESS_LIKE",
            confidence: score >= 3 ? "MEDIUM" : "LOW",
            pageNumber: page.pageNumber,
            start: spanStart,
            end: spanEnd,
            maskedPreview: maskAddress(value, pinCode),
            detectionMethod: `heuristic:address-keywords${pin ? "+pin" : ""}${labelMatch ? "+label" : ""} (limited)`,
            value,
            normalized: value.replace(/\s+/g, " ").trim().toLowerCase(),
          });
        }
      }
      lineStart = lineEnd + 1;
    }
    return out;
  }
}

const NUMERIC_TYPES = new Set<PiiType>(["AADHAAR_LIKE", "PHONE_NUMBER", "IP_ADDRESS"]);
const CONFIDENCE_RANK: Record<PiiConfidence, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/** Overlapping numeric matches (e.g. a 12-digit value that also parses as +91 phone) keep the stronger one. */
function resolveOverlaps(detections: PiiDetection[]): PiiDetection[] {
  const sorted = [...detections].sort((a, b) => a.pageNumber - b.pageNumber || a.start - b.start);
  const kept: PiiDetection[] = [];
  for (const d of sorted) {
    const clash = kept.findIndex(
      (k) =>
        k.pageNumber === d.pageNumber &&
        k.start < d.end &&
        d.start < k.end &&
        (k.type === d.type || (NUMERIC_TYPES.has(k.type) && NUMERIC_TYPES.has(d.type))),
    );
    if (clash === -1) {
      kept.push(d);
      continue;
    }
    const k = kept[clash];
    const better =
      CONFIDENCE_RANK[d.confidence] > CONFIDENCE_RANK[k.confidence] ||
      (CONFIDENCE_RANK[d.confidence] === CONFIDENCE_RANK[k.confidence] && d.end - d.start > k.end - k.start);
    if (better) kept[clash] = d;
  }
  return kept.sort((a, b) => a.pageNumber - b.pageNumber || a.start - b.start);
}

export class DeterministicPiiDetectionProvider implements PiiDetectionProvider {
  readonly name = "deterministic-rules-v1";
  readonly coverage: Record<PiiType, PiiCoverage>;

  constructor(private readonly addressStrategy: AddressDetectionStrategy = new HeuristicAddressDetection()) {
    this.coverage = {
      AADHAAR_LIKE: "PATTERN",
      PHONE_NUMBER: "PATTERN",
      EMAIL_ADDRESS: "PATTERN",
      IP_ADDRESS: "PATTERN",
      ADDRESS_LIKE: addressStrategy.limited ? "HEURISTIC_LIMITED" : "PATTERN",
    };
  }

  detectSync(pages: PiiTextPage[]): PiiDetection[] {
    const all: PiiDetection[] = [];
    for (const page of pages) {
      all.push(
        ...detectAadhaar(page),
        ...detectPhones(page),
        ...detectEmails(page),
        ...detectIpv4(page),
        ...this.addressStrategy.detect(page),
      );
    }
    return resolveOverlaps(all);
  }

  async detect(pages: PiiTextPage[]): Promise<PiiDetection[]> {
    return this.detectSync(pages);
  }
}

/**
 * Replaces anything the deterministic rules recognise with its masked form.
 * Used as a defence-in-depth filter on free text that is about to be
 * persisted in non-PII stores (audit reasons/metadata, notifications).
 */
export function maskPiiInText(text: string): string {
  if (!text) return text;
  const detections = defaultDeterministicProvider.detectSync([{ pageNumber: 1, text }]);
  if (detections.length === 0) return text;
  let out = "";
  let cursor = 0;
  for (const d of [...detections].sort((a, b) => a.start - b.start)) {
    if (d.start < cursor) continue;
    out += text.slice(cursor, d.start) + d.maskedPreview;
    cursor = d.end;
  }
  return out + text.slice(cursor);
}

const defaultDeterministicProvider = new DeterministicPiiDetectionProvider();
