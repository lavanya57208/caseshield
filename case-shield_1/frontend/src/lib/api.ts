import axios, { AxiosError } from "axios";

// Typed, single API client. The frontend never talks to storage, KMS, or
// the database directly — only this HTTP surface. See docs/api.md.
export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("case_shield_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export interface NormalizedApiError {
  code: string;
  message: string;
  requestId?: string;
  status?: number;
}

export function normalizeApiError(err: unknown): NormalizedApiError {
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError<{ error?: { code: string; message: string; requestId: string } }>;
    const payload = ax.response?.data?.error;
    if (payload) {
      return { code: payload.code, message: payload.message, requestId: payload.requestId, status: ax.response?.status };
    }
    if (ax.code === "ERR_NETWORK") {
      return { code: "NETWORK_ERROR", message: "Could not reach the Case Shield API. Is the backend running?" };
    }
  }
  return { code: "UNKNOWN_ERROR", message: "An unexpected error occurred." };
}
