/**
 * FICTIONAL PII fixtures for the Phase 2 demo and tests.
 *
 * Every value here is synthetic and chosen from reserved / obviously
 * patterned ranges:
 *  - Emails use example.org / example.com (reserved by RFC 2606).
 *  - IP addresses use 203.0.113.0/24 and 198.51.100.0/24 (RFC 5737
 *    documentation ranges).
 *  - The Aadhaar-like number is a repeating 9999 8888 777x pattern with a
 *    computed check digit — not a real person's number.
 *  - Phone numbers use a patterned 98765 0000x series.
 *  - PIN code 999001 is outside the civilian PIN range.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { verhoeffCheckDigit } from "../../backend/src/modules/privacy/pii/verhoeff";

const AADHAAR_BASE = "99998888777";

export const FICTIONAL_PII = {
  aadhaar: `${AADHAAR_BASE.slice(0, 4)} ${AADHAAR_BASE.slice(4, 8)} ${AADHAAR_BASE.slice(8)}${verhoeffCheckDigit(AADHAAR_BASE)}`,
  phone: "+91 98765 00001",
  phoneAlt: "98765-00002",
  email: "complainant.demo@example.org",
  ip: "203.0.113.45",
  addressLine: "Flat 12, Example Residency, Demo Nagar Road, Fictional City - 999001",
};

/** Values whose raw form must never appear in API responses, audit rows or redacted outputs. */
export const RAW_PII_VALUES = [
  FICTIONAL_PII.aadhaar,
  FICTIONAL_PII.aadhaar.replace(/\s/g, ""),
  FICTIONAL_PII.phone,
  "9876500001",
  FICTIONAL_PII.phoneAlt,
  "9876500002",
  FICTIONAL_PII.email,
  FICTIONAL_PII.ip,
  "Example Residency",
];

export function fictionalContactSheetLines(caseNumber: string): string[] {
  return [
    "FICTIONAL COMPLAINANT CONTACT SHEET",
    `Case: ${caseNumber}   (synthetic demonstration content only)`,
    "",
    "Complainant: Demo Complainant A (fictional)",
    `Aadhaar No: ${FICTIONAL_PII.aadhaar}`,
    `Mobile: ${FICTIONAL_PII.phone}`,
    `Alternate contact: ${FICTIONAL_PII.phoneAlt}`,
    `Email: ${FICTIONAL_PII.email}`,
    `Address: ${FICTIONAL_PII.addressLine}`,
    "",
    "Incident notes:",
    `Suspicious login observed from IP address ${FICTIONAL_PII.ip} on 2026-09-09.`,
    "Secondary host 198.51.100.7 appears in the firewall export (fictional).",
    "No other identifying information is recorded on this sheet.",
  ];
}

export async function buildFictionalContactSheetPdf(caseNumber: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  let y = 780;
  fictionalContactSheetLines(caseNumber).forEach((line, i) => {
    if (line) page.drawText(line, { x: 56, y, size: i === 0 ? 14 : 11, font: i === 0 ? bold : font, color: rgb(0.1, 0.1, 0.12) });
    y -= i === 0 ? 26 : 18;
  });
  doc.setTitle("Fictional complainant contact sheet");
  doc.setProducer("Case Shield demo fixture");
  // Fixed dates keep the fixture byte-for-byte reproducible.
  doc.setCreationDate(new Date("2026-09-10T00:00:00Z"));
  doc.setModificationDate(new Date("2026-09-10T00:00:00Z"));
  return Buffer.from(await doc.save());
}
