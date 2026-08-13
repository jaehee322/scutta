import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { AUTH_EXPIRED_EVENT, ApiError, apiRequest, jsonBody } from "../api/client";
import type { UserRead } from "../types";

interface AuthContextValue {
  user: UserRead | null;
  booting: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserRead | null>(null);
  const [booting, setBooting] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const current = await apiRequest<UserRead>("/auth/me");
      setUser(current);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        return;
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    refreshUser()
      .catch(() => setUser(null))
      .finally(() => setBooting(false));
  }, [refreshUser]);

  useEffect(() => {
    const clearExpiredSession = () => setUser(null);
    window.addEventListener(AUTH_EXPIRED_EVENT, clearExpiredSession);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, clearExpiredSession);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const response = await apiRequest<{ user: UserRead }>("/auth/login", {
      method: "POST",
      body: jsonBody({ username, password }),
    });
    setUser(response.user);
  }, []);

  const logout = useCallback(async () => {
    await apiRequest<{ message: string }>("/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, booting, login, logout, refreshUser }),
    [user, booting, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
