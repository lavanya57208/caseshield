import { env } from "@/config/env";

// Shared authenticated POST transport for the Google Cloud AI adapters
// (Vertex AI, Document AI). Credentials come from Application Default
// Credentials (GOOGLE_APPLICATION_CREDENTIALS / the Cloud Run service
// account) and never reach the frontend. The transport is injectable so the
// adapters' request shaping and response parsing can be unit-tested offline.
//
// Errors are rethrown WITHOUT the response body: provider error payloads can
// echo request content, and document content must never reach logs.

export type GoogleTransport = (url: string, body: unknown) => Promise<any>;

let authClientPromise: Promise<any> | undefined;

export const defaultGoogleTransport: GoogleTransport = async (url, body) => {
  if (!authClientPromise) {
    authClientPromise = (async () => {
      const { GoogleAuth } = await import("google-auth-library");
      return new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
    })();
  }
  const client = await authClientPromise;
  try {
    const res = await client.request({ url, method: "POST", data: body, timeout: 60_000 });
    return res.data;
  } catch (err: any) {
    const status = err?.response?.status ?? err?.code ?? "unknown";
    throw new Error(`Google Cloud API request failed (status ${status}).`);
  }
};

export function requireGoogleProject(service: string): { project: string; region: string } {
  if (!env.GOOGLE_CLOUD_PROJECT_ID) {
    throw new Error(`${service} is not configured. Set GOOGLE_CLOUD_PROJECT_ID (and credentials via Application Default Credentials).`);
  }
  return { project: env.GOOGLE_CLOUD_PROJECT_ID, region: env.GOOGLE_CLOUD_REGION || "us-central1" };
}
