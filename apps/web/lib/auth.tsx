"use client";

import type { AuthUser } from "@stabil/types";
import { createContext, useContext, useEffect, useState } from "react";

import { api, clearTokens, getAccessToken, setTokens } from "./api";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (input: { email: string; password: string; name?: string; role?: string }) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (getAccessToken()) {
        try {
          setUser(await api.me());
        } catch {
          clearTokens();
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.login(email, password);
    setTokens(res.tokens);
    setUser(res.user);
    return res.user;
  };

  const register = async (input: { email: string; password: string; name?: string; role?: string }) => {
    const res = await api.register(input);
    setTokens(res.tokens);
    setUser(res.user);
    return res.user;
  };

  const logout = async () => {
    clearTokens();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
