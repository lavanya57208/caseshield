import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { api, normalizeApiError } from "@/lib/api";
import { AuthUser, RoleKey } from "@/types";

interface AuthContextValue {
  user: AuthUser | null;
  permissions: string[];
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (...roles: RoleKey[]) => boolean;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data.user);
      setPermissions(data.permissions ?? []);
    } catch {
      setUser(null);
      setPermissions([]);
      localStorage.removeItem("case_shield_token");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const { data } = await api.post("/auth/login", { email, password });
      localStorage.setItem("case_shield_token", data.token);
      setUser(data.user);
      await loadMe();
    } catch (err) {
      throw normalizeApiError(err);
    }
  }, [loadMe]);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      localStorage.removeItem("case_shield_token");
      setUser(null);
      setPermissions([]);
    }
  }, []);

  const hasRole = useCallback((...roles: RoleKey[]) => !!user && user.roles.some((r) => roles.includes(r.key)), [user]);
  const hasPermission = useCallback((permission: string) => permissions.includes(permission), [permissions]);

  return (
    <AuthContext.Provider value={{ user, permissions, loading, login, logout, hasRole, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
