import axios from "axios";
import { api, normalizeApiError, NormalizedApiError } from "@/lib/api";
import { SharePurpose } from "@/types";

// File retrieval helpers. Every request goes through the authenticated API;
// the frontend never has storage URLs. Errors on blob responses arrive as a
// Blob, so they are decoded back into the standard error shape here.

export async function fetchBlob(url: string): Promise<{ blob: Blob; fileName?: string }> {
  try {
    const response = await api.get(url, { responseType: "blob" });
    const disposition: string | undefined = response.headers["content-disposition"];
    const fileName = disposition?.match(/filename="([^"]+)"/)?.[1];
    return { blob: response.data as Blob, fileName };
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.data instanceof Blob) {
      try {
        const payload = JSON.parse(await err.response.data.text());
        throw { code: payload.error?.code, message: payload.error?.message, status: err.response.status } as NormalizedApiError;
      } catch (parsed) {
        if ((parsed as NormalizedApiError).message) throw parsed;
      }
    }
    throw normalizeApiError(err);
  }
}

export async function downloadFile(url: string, fallbackName: string) {
  const { blob, fileName } = await fetchBlob(url);
  const href = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName ?? fallbackName;
  a.click();
  setTimeout(() => window.URL.revokeObjectURL(href), 1000);
}

/** Opens a protected file inline in a new tab (still delivered as bytes — see docs on view-only limits). */
export async function viewFile(url: string) {
  const tab = window.open("", "_blank");
  try {
    const { blob } = await fetchBlob(url);
    const href = window.URL.createObjectURL(blob);
    if (tab) tab.location.href = href;
    else window.location.href = href;
    setTimeout(() => window.URL.revokeObjectURL(href), 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}

export const SHARE_PURPOSE_OPTIONS: { value: SharePurpose; label: string }[] = [
  { value: "INVESTIGATION", label: "Investigation" },
  { value: "FORENSIC_EXAMINATION", label: "Forensic Examination" },
  { value: "COURT_FILING", label: "Court Filing" },
  { value: "LEGAL_REVIEW", label: "Legal Review" },
  { value: "EVIDENCE_VERIFICATION", label: "Evidence Verification" },
  { value: "ADMINISTRATIVE_REVIEW", label: "Administrative Review" },
  { value: "OTHER", label: "Other" },
];
