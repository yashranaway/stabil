import type { AudienceScoreResult } from "@stabil/scoring";
import type { AuthUser, CreateProfileDto, RawAnswers, TokenPair } from "@stabil/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3301";

const ACCESS_KEY = "stabil.access";
const REFRESH_KEY = "stabil.refresh";

const hasStorage = (): boolean => typeof window !== "undefined" && !!window.localStorage;

export function getAccessToken(): string | null {
  return hasStorage() ? window.localStorage.getItem(ACCESS_KEY) : null;
}
function getRefreshToken(): string | null {
  return hasStorage() ? window.localStorage.getItem(REFRESH_KEY) : null;
}
export function setTokens(t: TokenPair): void {
  if (!hasStorage()) return;
  window.localStorage.setItem(ACCESS_KEY, t.accessToken);
  window.localStorage.setItem(REFRESH_KEY, t.refreshToken);
}
export function clearTokens(): void {
  if (!hasStorage()) return;
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}

interface ProblemDetails {
  title?: string;
  detail?: string;
  status?: number;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function refreshTokens(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    setTokens((await res.json()) as TokenPair);
    return true;
  } catch {
    return false;
  }
}

interface RequestOpts {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

async function request<T>(path: string, { method = "GET", body, auth = true }: RequestOpts = {}): Promise<T> {
  const send = (token: string | null) =>
    fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let res: Response;
  try {
    res = await send(auth ? getAccessToken() : null);
    if (res.status === 401 && auth && (await refreshTokens())) {
      res = await send(getAccessToken());
    }
  } catch {
    throw new ApiError(`Could not reach the API at ${API_BASE}.`, 0);
  }

  if (!res.ok) {
    let message = `Request failed (HTTP ${res.status}).`;
    try {
      const problem = (await res.json()) as ProblemDetails;
      message = problem.detail ?? problem.title ?? message;
    } catch {
      /* non-JSON */
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---- Domain response shapes (subset of what the API returns) ----
export interface AuthResult {
  user: AuthUser;
  tokens: TokenPair;
}
export interface Profile {
  id: string;
  displayName: string;
  mode: "fresher" | "professional";
  claimStatus: "UNCLAIMED" | "CLAIMED";
  ownerUserId: string | null;
  createdAt: string;
  latestScore?: { total: number; tier: string } | null;
}
export interface ScoreRunSummary {
  id: string;
  total: number;
  tier: string;
  createdAt: string;
}
export interface Report extends AudienceScoreResult {
  profile: { id: string; displayName: string };
  generatedAt: string;
  suggestions: string[];
}
export interface ShareGrant {
  id: string;
  profileId: string;
  granteeEmail: string;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  expiresAt: string;
  createdAt: string;
}

export const api = {
  // auth
  register: (body: { email: string; password: string; name?: string; role?: string }) =>
    request<AuthResult>("/api/v1/auth/register", { method: "POST", body, auth: false }),
  login: (email: string, password: string) =>
    request<AuthResult>("/api/v1/auth/login", { method: "POST", body: { email, password }, auth: false }),
  me: () => request<AuthUser>("/api/v1/auth/me"),
  logout: (refreshToken: string) =>
    request<void>("/api/v1/auth/logout", { method: "POST", body: { refreshToken } }),

  // profiles
  createProfile: (body: CreateProfileDto) => request<Profile>("/api/v1/profiles", { method: "POST", body }),
  listMyProfiles: () => request<Profile[]>("/api/v1/profiles/mine"),
  getProfile: (id: string) => request<Profile>(`/api/v1/profiles/${id}`),
  submitCandidate: (body: { displayName: string; mode: string; candidateEmail: string }) =>
    request<Profile>("/api/v1/profiles/submit-candidate", { method: "POST", body }),
  claimProfile: (id: string) => request<Profile>(`/api/v1/profiles/${id}/claim`, { method: "POST" }),
  scoreProfile: (id: string, answers: RawAnswers) =>
    request<AudienceScoreResult>(`/api/v1/profiles/${id}/score`, { method: "POST", body: { answers } }),
  listScoreRuns: (id: string) => request<ScoreRunSummary[]>(`/api/v1/profiles/${id}/score-runs`),

  // parsing (Phase 2)
  parseResume: (resumeText: string) =>
    request<{ extracted: Record<string, unknown>; suggestions: Record<string, number> }>(
      "/api/v1/parse/resume",
      { method: "POST", body: { resumeText } },
    ),

  // reports
  getReport: (profileId: string) => request<Report>(`/api/v1/profiles/${profileId}/report`),

  // consent / shares
  createShare: (body: { profileId: string; granteeEmail: string; expiresInDays?: number }) =>
    request<ShareGrant>("/api/v1/shares", { method: "POST", body }),
  listMyShares: () => request<ShareGrant[]>("/api/v1/shares/mine"),
  listSharedToMe: () => request<ShareGrant[]>("/api/v1/shares/granted-to-me"),
  revokeShare: (id: string) => request<void>(`/api/v1/shares/${id}`, { method: "DELETE" }),

  // anonymous one-shot scoring (no account)
  scoreAnonymous: (answers: RawAnswers) =>
    request<AudienceScoreResult>("/api/v1/score", { method: "POST", body: { answers }, auth: false }),
};

/** Back-compat alias used by the anonymous ScoreFlow. */
export const scoreAnswers = api.scoreAnonymous;
