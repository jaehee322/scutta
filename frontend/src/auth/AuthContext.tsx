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
import { getAuthSessionVersion, invalidateAuthSession } from "./authSession";

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
  const authCheck = useRef<AbortController | null>(null);

  const refreshUser = useCallback(async () => {
    const requestId = ++authRequestId.current;
    authCheck.current?.abort();
    const controller = new AbortController();
    authCheck.current = controller;
    const sessionVersion = getAuthSessionVersion();
    const isCurrent = () => requestId === authRequestId.current
      && sessionVersion === getAuthSessionVersion()
      && !controller.signal.aborted;
    setBooting(true);
    setConnectionError("");
    try {
      // A sleeping server may need longer for the first connection. This is a
      // single read, so writes retain their normal deadline and are not retried.
      const current = await apiRequest<UserRead>("/auth/me", {
        signal: controller.signal,
        timeoutMs: 60_000,
      });
      if (!isCurrent()) return;
      setUser(current);
    } catch (error) {
      if (!isCurrent()) return;
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
      authCheck.current?.abort();
    };
  }, [refreshUser]);

  useEffect(() => {
    const clearExpiredSession = () => {
      authCheck.current?.abort();
      setUser(null);
      setBooting(false);
      setConnectionError("");
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, clearExpiredSession);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, clearExpiredSession);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const requestId = ++authRequestId.current;
    authCheck.current?.abort();
    invalidateAuthSession();
    setBooting(false);
    const response = await apiRequest<{ user: UserRead }>("/auth/login", {
      method: "POST",
      body: jsonBody({ username, password }),
    });
    if (requestId !== authRequestId.current) return;
    // Requests started while login was in progress still used the old cookie.
    invalidateAuthSession();
    setConnectionError("");
    setUser(response.user);
  }, []);

  const logout = useCallback(async () => {
    const requestId = ++authRequestId.current;
    authCheck.current?.abort();
    invalidateAuthSession();
    setBooting(false);
    await apiRequest<{ message: string }>("/auth/logout", { method: "POST" });
    if (requestId !== authRequestId.current) return;
    invalidateAuthSession();
    setUser(null);
    setConnectionError("");
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
