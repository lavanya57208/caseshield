import { Req, Res, NextFn } from "../lib/miniserver";
import { verifyToken } from "../lib/jwt";
import { db } from "../db";
import { AuthUser, Role } from "../lib/permissions";

export function requireAuth(req: Req, res: Res, next: NextFn) {
  const header = req.headers.authorization;
  if (!header || typeof header !== "string" || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  try {
    const payload = verifyToken(header.slice(7));
    const row = db
      .prepare("SELECT id, name, role, department, is_active FROM users WHERE id = ?")
      .get(payload.sub) as { id: string; name: string; role: Role; department: string; is_active: number } | undefined;

    if (!row || !row.is_active) {
      res.status(401).json({ error: "Session is no longer valid." });
      return;
    }
    req.user = { id: row.id, name: row.name, role: row.role, department: row.department } as AuthUser;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session." });
  }
}
