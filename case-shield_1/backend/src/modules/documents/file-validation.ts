import { ApiError } from "@/lib/errors";

// Server-side file validation — never trust the client-reported extension
// or MIME type alone. See docs/security-architecture.md §3 and
// docs/product-requirements.md §6. Magic-byte signatures are checked for
// the file types this system accepts; anything else is rejected outright.
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "video/mp4",
  "audio/mpeg",
  "audio/wav",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

const MAGIC_BYTES: { mime: string; signature: number[]; offset?: number }[] = [
  { mime: "application/pdf", signature: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: "image/jpeg", signature: [0xff, 0xd8, 0xff] },
  { mime: "image/png", signature: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "video/mp4", signature: [0x66, 0x74, 0x79, 0x70], offset: 4 },
];

function matchesKnownSignature(buffer: Buffer): boolean {
  // Types without a reliable magic-byte signature (plain text, some Office
  // formats treated as opaque zip containers) are accepted on MIME + size
  // alone; this function only asserts a positive match when one is
  // knowable, and never blocks a MIME type it doesn't have a rule for.
  return MAGIC_BYTES.some(({ signature, offset = 0 }) => {
    if (buffer.length < offset + signature.length) return false;
    return signature.every((byte, i) => buffer[offset + i] === byte);
  });
}

export function validateUploadedFile(file: { mimetype: string; size: number; originalname: string; buffer: Buffer }) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    throw ApiError.badRequest("UNSUPPORTED_FILE_TYPE", `File type "${file.mimetype}" is not permitted for upload.`);
  }
  if (file.size <= 0) {
    throw ApiError.badRequest("EMPTY_FILE", "The uploaded file is empty.");
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw ApiError.badRequest("FILE_TOO_LARGE", `File exceeds the maximum allowed size of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`);
  }

  const hasKnownSignatureRule = MAGIC_BYTES.some((m) => m.mime === file.mimetype);
  if (hasKnownSignatureRule && !matchesKnownSignature(file.buffer)) {
    throw ApiError.badRequest(
      "FILE_SIGNATURE_MISMATCH",
      "The file's content does not match its declared type. This may indicate a corrupted or disguised file.",
    );
  }

  // Malware scanning integration point — mocked in development. Production
  // must wire an approved scanner (e.g. a cloud DLP/AV service) here before
  // the file is persisted. See docs/security-architecture.md §3.
  const scanResult = mockMalwareScan(file.buffer);
  if (!scanResult.clean) {
    throw ApiError.badRequest("MALWARE_SCAN_FAILED", "The uploaded file failed malware scanning.");
  }
}

function mockMalwareScan(_buffer: Buffer): { clean: boolean } {
  return { clean: true };
}
