import { IdentityProvider, IdentityVerificationResult } from "@/modules/auth/identity-provider.types";
import { env } from "@/config/env";

// PRODUCTION ADAPTER (structural). Verifies credentials against Google
// Identity Platform. Not exercised without live GCP credentials in this
// sandbox — see docs/security-architecture.md §16.
export class GoogleIdentityPlatformProvider implements IdentityProvider {
  readonly name = "GoogleIdentityPlatformProvider (production)";

  async verifyCredentials(email: string, password: string): Promise<IdentityVerificationResult> {
    if (!env.IDENTITY_PLATFORM_PROJECT_ID || !env.IDENTITY_PLATFORM_API_KEY) {
      throw new Error(
        "IDENTITY_PLATFORM_PROJECT_ID / IDENTITY_PLATFORM_API_KEY are not configured for production identity verification.",
      );
    }
    // Calls the Identity Platform "signInWithPassword" REST endpoint in a
    // real deployment. Left as a structural stub here (no network egress /
    // credentials available in this environment) rather than faking a
    // successful cloud call — see docs/security-architecture.md.
    throw new Error(
      "GoogleIdentityPlatformProvider is not connected in this environment. Configure Identity Platform credentials and implement the REST call before enabling CASE_SHIELD_ENV=production.",
    );
    // eslint-disable-next-line no-unreachable
    return { valid: false };
  }
}
