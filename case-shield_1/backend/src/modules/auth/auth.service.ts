import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { ApiError } from "@/lib/errors";
import { getIdentityProvider } from "@/modules/auth/index";
import { AuditService } from "@/modules/audit/audit.service";
import { SecurityService } from "@/modules/security/security.service";

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

export const AuthService = {
  async login(email: string, password: string, requestId: string, ipMetadata?: string) {
    const verification = await getIdentityProvider().verifyCredentials(email.toLowerCase(), password);

    if (!verification.valid || !verification.userId) {
      await SecurityService.record({
        type: "FAILED_LOGIN",
        detail: `Failed login attempt for ${email}`,
        severity: "LOW",
      });
      await AuditService.record({
        action: "LOGIN_FAILURE",
        resource: "auth",
        result: "DENIED",
        reason: verification.reason,
        requestId,
        ipMetadata,
      });
      throw ApiError.unauthorized("Invalid email or password.");
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: verification.userId },
      include: { userRoles: { include: { role: true } } },
    });

    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: uuidv4(), // opaque reference; the JWT itself is the bearer credential
        expiresAt,
        ipMetadata,
      },
    });

    const token = jwt.sign({ sub: user.id, sessionId: session.id }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    });

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    await AuditService.record({
      actorId: user.id,
      actorRole: user.userRoles[0]?.role.key,
      action: "LOGIN",
      resource: "auth",
      result: "SUCCESS",
      requestId,
      ipMetadata,
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        department: user.department,
        officialIdentifier: user.officialIdentifier,
        organizationId: user.organizationId,
        roles: user.userRoles.map((ur) => ({ key: ur.role.key, name: ur.role.name })),
        mfaEnabled: user.mfaEnabled,
        lastLoginAt: user.lastLoginAt,
      },
    };
  },

  async logout(sessionId: string, userId: string, requestId: string) {
    await prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    await AuditService.record({ actorId: userId, action: "LOGOUT", resource: "auth", result: "SUCCESS", requestId });
  },
};
