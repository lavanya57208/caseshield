import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "@/config/env";
import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  organizationId: string;
  roles: string[]; // role keys, e.g. INVESTIGATOR
  roleIds: string[]; // role table UUIDs, used for case/document-level role grants
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

interface CaseShieldJwtPayload {
  sub: string;
  sessionId: string;
}

// The backend NEVER trusts a role, user ID, case ID, or document ID sent
// by the client. Identity is derived solely from a verified session token
// and re-fetched from the database on every request — see
// docs/security-architecture.md §5 and docs/api.md §API Security.
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.header("authorization");
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const cookieToken = (req as any).cookies?.case_shield_session;
    const token = bearer ?? cookieToken;

    if (!token) {
      throw ApiError.unauthorized();
    }

    let payload: CaseShieldJwtPayload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET) as CaseShieldJwtPayload;
    } catch {
      throw ApiError.unauthorized("Your session is invalid or has expired.");
    }

    const session = await prisma.session.findUnique({ where: { id: payload.sessionId } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw ApiError.unauthorized("Your session is invalid or has expired.");
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { userRoles: { include: { role: true } } },
    });

    if (!dbUser || dbUser.status !== "ACTIVE" || dbUser.deletedAt) {
      throw ApiError.unauthorized("This account is not active.");
    }

    req.user = {
      id: dbUser.id,
      email: dbUser.email,
      fullName: dbUser.fullName,
      organizationId: dbUser.organizationId,
      roles: dbUser.userRoles.map((ur) => ur.role.key),
      roleIds: dbUser.userRoles.map((ur) => ur.role.id),
    };

    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    return next(ApiError.unauthorized());
  }
  next();
}
