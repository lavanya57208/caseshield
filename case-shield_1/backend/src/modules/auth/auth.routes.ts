import { Router } from "express";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { validate } from "@/middleware/validate";
import { LoginSchema } from "@/modules/auth/auth.schemas";
import { AuthService } from "@/modules/auth/auth.service";
import { authenticate, requireAuth } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { ROLE_BASELINE_PERMISSIONS } from "@/lib/permissions";

const router = Router();

// Brute-force protection on the login route specifically — see
// docs/security-architecture.md §3.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many login attempts. Please try again later." } },
});

router.post("/login", loginLimiter, validate(LoginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    const result = await AuthService.login(email, password, req.requestId, req.ip);
    res.cookie("case_shield_session", result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/logout", authenticate, requireAuth, async (req, res, next) => {
  try {
    const header = req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : (req as any).cookies?.case_shield_session;
    const payload = jwt.decode(token) as { sessionId?: string } | null;
    if (payload?.sessionId) {
      await AuthService.logout(payload.sessionId, req.user!.id, req.requestId);
    }
    res.clearCookie("case_shield_session");
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.get("/me", authenticate, requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { userRoles: { include: { role: true } }, organization: true },
    });
    const permissions = Array.from(
      new Set(req.user!.roles.flatMap((role) => ROLE_BASELINE_PERMISSIONS[role] ?? [])),
    );
    res.json({
      user: {
        id: user!.id,
        email: user!.email,
        fullName: user!.fullName,
        department: user!.department,
        officialIdentifier: user!.officialIdentifier,
        organization: user!.organization.name,
        roles: user!.userRoles.map((ur) => ({ key: ur.role.key, name: ur.role.name })),
        mfaEnabled: user!.mfaEnabled,
        lastLoginAt: user!.lastLoginAt,
      },
      permissions,
    });
  } catch (err) {
    next(err);
  }
});

// MFA-ready stub: structurally present, not enforced by default in this
// prototype's seed data — see docs/security-architecture.md §4/§16.
router.post("/mfa/verify", authenticate, requireAuth, async (_req, res) => {
  res.json({ verified: true, note: "MFA verification is a structural stub in this prototype." });
});

export default router;
