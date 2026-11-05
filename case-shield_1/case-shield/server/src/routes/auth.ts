import { Router } from "../lib/miniserver";
import { db } from "../db";
import { signToken } from "../lib/jwt";
import { verifyPassword } from "../lib/password";
import { writeAudit } from "../lib/audit";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.post("/login", (req, res) => {
  const { employeeId, password } = (req.body || {}) as { employeeId?: string; password?: string };
  if (!employeeId || !password) {
    res.status(400).json({ error: "Employee ID and password are required." });
    return;
  }

  const user = db
    .prepare("SELECT * FROM users WHERE employee_id = ? COLLATE NOCASE")
    .get(employeeId) as any;

  if (!user || !verifyPassword(password, user.password_hash)) {
    writeAudit({
      actor: null,
      action: "Failed Login",
      resourceType: "system",
      result: "Failure",
      metadata: { employee_id: employeeId },
    });
    res.status(401).json({ error: "Invalid Employee ID or password." });
    return;
  }

  if (!user.is_active) {
    res.status(403).json({ error: "This account has been deactivated." });
    return;
  }

  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(new Date().toISOString(), user.id);

  const token = signToken({ sub: user.id, role: user.role, name: user.name });

  writeAudit({
    actor: { id: user.id, name: user.name, role: user.role },
    action: "Login",
    resourceType: "system",
    result: "Success",
    metadata: { employee_id: user.employee_id },
  });

  res.json({
    token,
    user: {
      id: user.id,
      employeeId: user.employee_id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
    },
  });
});

router.post("/logout", requireAuth, (req, res) => {
  writeAudit({ actor: req.user!, action: "Logout", resourceType: "system", result: "Success" });
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  const row = db
    .prepare("SELECT id, employee_id as employeeId, name, email, role, department, last_login_at as lastLoginAt FROM users WHERE id = ?")
    .get(req.user!.id);
  res.json(row);
});

export default router;
