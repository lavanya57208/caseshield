import { prisma } from "@/lib/prisma";

// Human-facing sequential-looking identifiers layered on top of UUID
// primary keys, e.g. CASE-2026-00427, DOC-2026-001842, EVD-2026-00091.
// Not guaranteed gap-free (concurrent inserts can skip numbers) — they are
// display/reference identifiers, not accounting sequences.

async function nextSequence(counterKey: string, year: number, width: number): Promise<string> {
  const prefix = `${counterKey}-${year}-`;
  const candidates = await latestByPrefix(counterKey, prefix);
  // Fixed-width, zero-padded suffixes sort lexicographically, so the first
  // purely numeric identifier carries the greatest number. Using max+1
  // (rather than count+1) avoids colliding with hand-picked demo numbers.
  const latest = candidates.map((c) => c.slice(prefix.length)).find((suffix) => /^\d+$/.test(suffix));
  return String((latest ? parseInt(latest, 10) : 0) + 1).padStart(width, "0");
}

async function latestByPrefix(counterKey: string, prefix: string): Promise<string[]> {
  const take = 50;
  switch (counterKey) {
    case "CASE":
      return (await prisma.case.findMany({ where: { caseNumber: { startsWith: prefix } }, orderBy: { caseNumber: "desc" }, select: { caseNumber: true }, take })).map((r) => r.caseNumber);
    case "DOC":
      return (await prisma.document.findMany({ where: { documentNumber: { startsWith: prefix } }, orderBy: { documentNumber: "desc" }, select: { documentNumber: true }, take })).map((r) => r.documentNumber);
    case "EVD":
      return (await prisma.evidence.findMany({ where: { evidenceNumber: { startsWith: prefix } }, orderBy: { evidenceNumber: "desc" }, select: { evidenceNumber: true }, take })).map((r) => r.evidenceNumber);
    default:
      throw new Error(`Unknown counter key: ${counterKey}`);
  }
}

export async function generateCaseNumber(): Promise<string> {
  const year = new Date().getFullYear();
  return `CASE-${year}-${await nextSequence("CASE", year, 5)}`;
}

export async function generateDocumentNumber(): Promise<string> {
  const year = new Date().getFullYear();
  return `DOC-${year}-${await nextSequence("DOC", year, 6)}`;
}

export async function generateEvidenceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  return `EVD-${year}-${await nextSequence("EVD", year, 5)}`;
}
