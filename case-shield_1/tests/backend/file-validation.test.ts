import { describe, it, expect } from "vitest";
import { validateUploadedFile } from "../../backend/src/modules/documents/file-validation";

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"

function baseFile(overrides: Partial<{ mimetype: string; size: number; originalname: string; buffer: Buffer }> = {}) {
  return {
    mimetype: "application/pdf",
    size: PDF_MAGIC.length,
    originalname: "report.pdf",
    buffer: PDF_MAGIC,
    ...overrides,
  };
}

describe("validateUploadedFile", () => {
  it("accepts a valid PDF with matching magic bytes", () => {
    expect(() => validateUploadedFile(baseFile())).not.toThrow();
  });

  it("rejects a disallowed MIME type", () => {
    expect(() => validateUploadedFile(baseFile({ mimetype: "application/x-msdownload" }))).toThrow(/not permitted/i);
  });

  it("rejects an empty file", () => {
    expect(() => validateUploadedFile(baseFile({ size: 0, buffer: Buffer.alloc(0) }))).toThrow(/empty/i);
  });

  it("rejects a file exceeding the maximum size", () => {
    expect(() => validateUploadedFile(baseFile({ size: 200 * 1024 * 1024 }))).toThrow(/exceeds the maximum/i);
  });

  it("rejects a PDF-declared file whose bytes do not match the PDF signature (disguised file)", () => {
    const fakeBuffer = Buffer.from("This is not really a PDF file at all.");
    expect(() => validateUploadedFile(baseFile({ buffer: fakeBuffer, size: fakeBuffer.length }))).toThrow(/does not match its declared type/i);
  });

  it("does not require a magic-byte match for types without a defined signature rule (e.g. plain text)", () => {
    const textBuffer = Buffer.from("Fictional witness statement content.");
    expect(() =>
      validateUploadedFile({ mimetype: "text/plain", size: textBuffer.length, originalname: "statement.txt", buffer: textBuffer }),
    ).not.toThrow();
  });
});
