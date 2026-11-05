// IdentityProvider — see docs/architecture.md §6 / §2. Authentication logic
// in the auth module depends only on this interface.

export interface IdentityVerificationResult {
  valid: boolean;
  userId?: string;
  reason?: string;
}

export interface IdentityProvider {
  readonly name: string;
  verifyCredentials(email: string, password: string): Promise<IdentityVerificationResult>;
}
