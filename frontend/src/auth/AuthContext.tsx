import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AUTH_EXPIRED_EVENT, apiRequest, jsonBody } from "../api/client";
import type { UserRead } from "../types";
import { classifyAuthCheckFailure } from "./authFailure";

interface AuthContextValue {
  user: UserRead | null;
  booting: boolean;
  connectionError: string;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserRead | null>(null);
  const [booting, setBooting] = useState(true);
  const [connectionError, setConnectionError] = useState("");
  const authRequestId = useRef(0);

  const refreshUser = useCallback(async () => {
    const requestId = ++authRequestId.current;
    setBooting(true);
    setConnectionError("");
    try {
      const current = await apiRequest<UserRead>("/auth/me");
      if (requestId !== authRequestId.current) return;
      setUser(current);
    } catch (error) {
      if (requestId !== authRequestId.current) return;
      const failure = classifyAuthCheckFailure(error);
      if (failure.kind === "unauthenticated") {
        setUser(null);
        return;
      }
      setConnectionError(failure.message);
    } finally {
      if (requestId === authRequestId.current) setBooting(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
    return () => {
      authRequestId.current += 1;
    };
  }, [refreshUser]);

  useEffect(() => {
    const clearExpiredSession = () => {
      setUser(null);
      setConnectionError("");
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, clearExpiredSession);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, clearExpiredSession);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const response = await apiRequest<{ user: UserRead }>("/auth/login", {
      method: "POST",
      body: jsonBody({ username, password }),
    });
    setConnectionError("");
    setUser(response.user);
  }, []);

  const logout = useCallback(async () => {
    await apiRequest<{ message: string }>("/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, booting, connectionError, login, logout, refreshUser }),
    [user, booting, connectionError, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
