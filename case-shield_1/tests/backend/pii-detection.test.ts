import { describe, it, expect } from "vitest";
import { DeterministicPiiDetectionProvider, maskPiiInText } from "../../backend/src/modules/privacy/pii/deterministic-pii.provider";
import { verhoeffCheckDigit, verhoeffValidate } from "../../backend/src/modules/privacy/pii/verhoeff";
import { FICTIONAL_PII, RAW_PII_VALUES, fictionalContactSheetLines } from "../../prisma/fixtures/fictional-pii-document";

// All values are fictional — see prisma/fixtures/fictional-pii-document.ts.
const provider = new DeterministicPiiDetectionProvider();
const detect = (text: string) => provider.detectSync([{ pageNumber: 1, text }]);
const ofType = (text: string, type: string) => detect(text).filter((d) => d.type === type);

describe("Aadhaar-like detection", () => {
  it("detects a checksum-valid 12-digit number with Aadhaar context at HIGH confidence", () => {
    const [d] = ofType(`Aadhaar No: ${FICTIONAL_PII.aadhaar}`, "AADHAAR_LIKE");
    expect(d).toBeDefined();
    expect(d.confidence).toBe("HIGH");
    expect(d.detectionMethod).toContain("verhoeff");
  });

  it("marks an uncontextualised, checksum-failing 12-digit number as LOW — not definitely Aadhaar", () => {
    const base = "23456789012";
    const wrongCheck = String((Number(verhoeffCheckDigit(base)) + 1) % 10);
    const [d] = ofType(`Reference ${base}${wrongCheck} recorded.`, "AADHAAR_LIKE");
    expect(d.confidence).toBe("LOW");
  });

  it("supports grouped and contiguous formats but not numbers starting with 0/1 or embedded in longer digit runs", () => {
    const digits = FICTIONAL_PII.aadhaar.replace(/\s/g, "");
    expect(ofType(`UID ${digits}`, "AADHAAR_LIKE")).toHaveLength(1);
    expect(ofType(`UID ${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}`, "AADHAAR_LIKE")).toHaveLength(1);
    expect(ofType("Account 1234 5678 9012", "AADHAAR_LIKE")).toHaveLength(0);
    expect(ofType(`Serial 7${digits}9`, "AADHAAR_LIKE")).toHaveLength(0);
  });

  it("validates Verhoeff check digits", () => {
    const base = "99998888777";
    expect(verhoeffValidate(base + verhoeffCheckDigit(base))).toBe(true);
    expect(verhoeffValidate(base + ((Number(verhoeffCheckDigit(base)) + 3) % 10))).toBe(false);
  });
});

describe("Indian phone number detection", () => {
  it.each([
    ["+91 98765 00001", "HIGH"],
    ["+919876500001", "HIGH"],
    ["Mobile: 98765-00002", "HIGH"],
    ["reach 987 650 0003 later", "MEDIUM"],
    ["09876500004", "MEDIUM"],
  ])("detects %s", (text, confidence) => {
    const found = ofType(text, "PHONE_NUMBER");
    expect(found).toHaveLength(1);
    expect(found[0].confidence).toBe(confidence);
  });

  it("does not flag numbers that are not Indian mobile numbers", () => {
    expect(ofType("Invoice 5876500001", "PHONE_NUMBER")).toHaveLength(0); // starts with 5
    expect(ofType("Batch 98765000011234", "PHONE_NUMBER")).toHaveLength(0); // longer digit run
  });
});

describe("email and IPv4 detection", () => {
  it("detects email addresses", () => {
    const [d] = ofType(`Contact ${FICTIONAL_PII.email} today`, "EMAIL_ADDRESS");
    expect(d.confidence).toBe("HIGH");
    expect(d.maskedPreview).toBe("c***@e***.org");
  });

  it("detects IPv4 addresses and rejects invalid octets / version strings", () => {
    expect(ofType(`login from IP ${FICTIONAL_PII.ip}`, "IP_ADDRESS")[0].confidence).toBe("HIGH");
    expect(ofType("value 300.1.2.3 here", "IP_ADDRESS")).toHaveLength(0);
    expect(ofType("build 1.2.3.4.5", "IP_ADDRESS")).toHaveLength(0);
    expect(ofType("software version 10.2.0.1", "IP_ADDRESS")[0].confidence).toBe("LOW");
  });
});

describe("address-like detection (limited heuristic)", () => {
  it("flags a labelled address line with a PIN code and marks the method as limited", () => {
    const [d] = ofType(`Address: ${FICTIONAL_PII.addressLine}`, "ADDRESS_LIKE");
    expect(d).toBeDefined();
    expect(d.detectionMethod).toContain("limited");
    // The label stays readable; only the address itself is in the span.
    expect(d.value.startsWith("Flat 12")).toBe(true);
  });

  it("reports address coverage as HEURISTIC_LIMITED rather than claiming full detection", () => {
    expect(provider.coverage.ADDRESS_LIKE).toBe("HEURISTIC_LIMITED");
  });

  it("does not flag ordinary prose without address signals", () => {
    expect(ofType("The main findings are summarised below.", "ADDRESS_LIKE")).toHaveLength(0);
  });
});

describe("masked output", () => {
  const sheet = fictionalContactSheetLines("CASE-2026-00427").join("\n");
  const detections = detect(sheet);

  it("finds every PII category in the fictional contact sheet", () => {
    const types = new Set(detections.map((d) => d.type));
    expect(types).toEqual(new Set(["AADHAAR_LIKE", "PHONE_NUMBER", "EMAIL_ADDRESS", "IP_ADDRESS", "ADDRESS_LIKE"]));
  });

  it("never includes the raw value in a masked preview", () => {
    for (const d of detections) {
      for (const raw of RAW_PII_VALUES) expect(d.maskedPreview).not.toContain(raw);
    }
    expect(detections.find((d) => d.type === "AADHAAR_LIKE")!.maskedPreview).toMatch(/^XXXX XXXX \d{4}$/);
    expect(detections.find((d) => d.type === "PHONE_NUMBER")!.maskedPreview).toMatch(/^XXXXXX\d{4}$/);
    expect(detections.find((d) => d.type === "IP_ADDRESS")!.maskedPreview).toMatch(/^\d{1,3}\.XXX\.XXX\.XXX$/);
  });

  it("maskPiiInText replaces detected values in free text", () => {
    const masked = maskPiiInText(`Rejected: call ${FICTIONAL_PII.phone} or mail ${FICTIONAL_PII.email}`);
    expect(masked).not.toContain(FICTIONAL_PII.email);
    expect(masked).not.toContain("98765 00001");
    expect(masked).toContain("XXXXXX0001");
  });
});
