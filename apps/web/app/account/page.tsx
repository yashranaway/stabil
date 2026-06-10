"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "@/lib/api";
import type { ShareGrant } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AccountShareRow } from "@/app/components/AccountShareRow";

export default function AccountPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();

  const [shares, setShares] = useState<ShareGrant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (authLoading || !user) return;
    let active = true;
    (async () => {
      try {
        const data = await api.listMyShares();
        if (active) setShares(data);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Could not load your shares.");
          setShares([]);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [authLoading, user]);

  async function revoke(id: string) {
    setRevokingId(id);
    setError(null);
    try {
      await api.revokeShare(id);
      const data = await api.listMyShares();
      setShares(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke this share.");
    } finally {
      setRevokingId(null);
    }
  }

  async function handleLogout() {
    await logout();
    router.push("/");
  }

  if (authLoading || !user) {
    return (
      <main>
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Account</h1>
      <p className="sub">Manage your profile and the reports you&apos;ve shared.</p>

      <div className="card">
        <h2>Your account</h2>
        <div className="field">
          <label>Name</label>
          <div>{user.name ?? "—"}</div>
        </div>
        <div className="field">
          <label>Email</label>
          <div>{user.email}</div>
        </div>
        <div className="field">
          <label>Role</label>
          <div>{user.role}</div>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void handleLogout()}>
          Log out
        </button>
      </div>

      <div style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>
          Reports I&apos;ve shared
        </h2>

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}

        {shares === null && !error && <p className="muted">Loading your shares…</p>}

        {shares !== null && shares.length === 0 && !error && (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              You haven&apos;t shared any reports yet.
            </p>
          </div>
        )}

        {shares !== null && shares.length > 0 && (
          <div className="grid">
            {shares.map((grant) => (
              <AccountShareRow
                key={grant.id}
                grant={grant}
                revoking={revokingId === grant.id}
                onRevoke={() => void revoke(grant.id)}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
