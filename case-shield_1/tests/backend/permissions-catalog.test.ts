import { describe, it, expect } from "vitest";
import { ALL_PERMISSIONS, ROLE_BASELINE_PERMISSIONS, PERMISSIONS } from "../../backend/src/lib/permissions";

describe("permission catalog integrity", () => {
  const knownKeys = new Set(ALL_PERMISSIONS.map((p) => p.key));

  it("every role baseline permission references a key that exists in the catalog", () => {
    for (const [role, keys] of Object.entries(ROLE_BASELINE_PERMISSIONS)) {
      for (const key of keys) {
        expect(knownKeys.has(key), `Role ${role} grants unknown permission "${key}"`).toBe(true);
      }
    }
  });

  it("does not grant document.delete or evidence.delete to any role by default (docs/security-architecture.md §14)", () => {
    const allGranted = new Set(Object.values(ROLE_BASELINE_PERMISSIONS).flat());
    expect(allGranted.has("document.delete" as any)).toBe(false);
    expect(allGranted.has("evidence.delete" as any)).toBe(false);
  });

  it("grants ADMIN the admin.manage permission and no other role", () => {
    expect(ROLE_BASELINE_PERMISSIONS.ADMIN).toContain(PERMISSIONS.ADMIN_MANAGE);
    for (const [role, keys] of Object.entries(ROLE_BASELINE_PERMISSIONS)) {
      if (role !== "ADMIN") {
        expect(keys).not.toContain(PERMISSIONS.ADMIN_MANAGE);
      }
    }
  });

  it("every permission key follows the resource.action convention", () => {
    for (const p of ALL_PERMISSIONS) {
      expect(p.key).toBe(`${p.resource}.${p.action}`);
    }
  });
});
