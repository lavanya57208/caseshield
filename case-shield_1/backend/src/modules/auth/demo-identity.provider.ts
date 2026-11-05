import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { IdentityProvider, IdentityVerificationResult } from "@/modules/auth/identity-provider.types";

// DEVELOPMENT ADAPTER. Verifies against the bcrypt password hash stored for
// seeded demo users (see prisma/seed.ts). These are fictional development
// identities only — never real personnel — and are labeled as such
// throughout the UI. Production swaps this for
// GoogleIdentityPlatformProvider without touching auth.service.ts.
export class DemoIdentityProvider implements IdentityProvider {
  readonly name = "DemoIdentityProvider (development)";

  async verifyCredentials(email: string, password: string): Promise<IdentityVerificationResult> {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || user.deletedAt || user.status !== "ACTIVE") {
      return { valid: false, reason: "No active account for this identifier." };
    }
    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      return { valid: false, reason: "Incorrect password." };
    }
    return { valid: true, userId: user.id };
  }
}
