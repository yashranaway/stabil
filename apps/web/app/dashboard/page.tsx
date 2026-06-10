"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type Profile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { DashboardCreateProfile, DashboardProfileCard } from "@/app/components/DashboardProfiles";

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProfiles(await api.listMyProfiles());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your profiles.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (user) void loadProfiles();
  }, [user, loadProfiles]);

  if (authLoading || !user) {
    return (
      <main>
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Dashboard</h1>
      <p className="sub">Manage your stability profiles, {user.name ?? user.email}.</p>

      <DashboardCreateProfile onCreated={(p) => setProfiles((cur) => (cur ? [p, ...cur] : [p]))} />

      <h2 style={{ fontSize: "1.1rem", margin: "32px 0 16px" }}>Your profiles</h2>

      {loading ? (
        <p className="muted">Loading profiles…</p>
      ) : error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : profiles && profiles.length > 0 ? (
        <div className="grid">
          {profiles.map((p) => (
            <DashboardProfileCard key={p.id} profile={p} />
          ))}
        </div>
      ) : (
        <p className="muted">No profiles yet. Create one above to get a stability score.</p>
      )}
    </main>
  );
}
