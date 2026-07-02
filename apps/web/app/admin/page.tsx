"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type AdminProfile, type AdminUser, type VerificationDoc } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function AdminPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [docs, setDocs] = useState<VerificationDoc[] | null>(null);
  const [profiles, setProfiles] = useState<AdminProfile[] | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && (!user || user.role !== "ADMIN")) router.replace("/");
  }, [loading, user, router]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, p, u] = await Promise.all([
        api.adminListPendingDocs(),
        api.adminListProfiles(),
        api.adminListUsers(),
      ]);
      setDocs(d);
      setProfiles(p);
      setUsers(u);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load admin data.");
    }
  }, []);

  useEffect(() => {
    if (user?.role === "ADMIN") void load();
  }, [user, load]);

  async function review(id: string, approve: boolean) {
    try {
      if (approve) await api.adminApproveDoc(id);
      else await api.adminRejectDoc(id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Review failed.");
    }
  }

  if (loading || !user || user.role !== "ADMIN") return <main>Loading…</main>;

  return (
    <main>
      <h1>Admin</h1>
      <p className="sub">
        Your account bypasses ownership and consent checks — every profile and report below
        opens directly, with no share grant required.
      </p>
      {error && <p className="error-text">{error}</p>}

      <h2 style={{ marginTop: 32 }}>All profiles ({profiles?.length ?? "…"})</h2>
      {!profiles ? (
        <p className="muted">Loading…</p>
      ) : profiles.length === 0 ? (
        <p className="muted">No profiles yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr>
                <th style={th}>Candidate</th>
                <th style={th}>Mode</th>
                <th style={th}>Score</th>
                <th style={th}>Claim</th>
                <th style={th}>Owner / invited email</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id}>
                  <td style={td}>{p.displayName}</td>
                  <td style={td}>{p.mode}</td>
                  <td style={td}>
                    {p.latestScoreRun ? `${p.latestScoreRun.total} · ${p.latestScoreRun.tier}` : "—"}
                  </td>
                  <td style={td}>{p.claimStatus}</td>
                  <td style={td}>{p.ownerEmail ?? p.candidateEmail ?? "—"}</td>
                  <td style={td}>
                    <Link href={`/profiles/${p.id}`} className="btn-secondary">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ marginTop: 40 }}>All users ({users?.length ?? "…"})</h2>
      {!users ? (
        <p className="muted">Loading…</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr>
                <th style={th}>Email</th>
                <th style={th}>Name</th>
                <th style={th}>Role</th>
                <th style={th}>Joined</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td style={td}>{u.email}</td>
                  <td style={td}>{u.name ?? "—"}</td>
                  <td style={td}>{u.role}</td>
                  <td style={td}>{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td style={td}>{u.deletedAt ? "Deleted" : "Active"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ marginTop: 40 }}>Verification review</h2>
      {!docs ? (
        <p className="muted">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="muted">Nothing pending.</p>
      ) : (
        <div className="grid">
          {docs.map((d) => (
            <div key={d.id} className="card">
              <h2>
                {d.kind} · {d.region}
              </h2>
              <p className="muted">
                Profile {d.profileId.slice(0, 8)}… · {new Date(d.createdAt).toLocaleString()}
              </p>
              <div className="row">
                <button className="btn" onClick={() => void review(d.id, true)}>
                  Approve
                </button>
                <button className="btn btn-secondary" onClick={() => void review(d.id, false)}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid var(--border)",
  color: "var(--muted)",
  fontWeight: 600,
  whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--border)",
};
