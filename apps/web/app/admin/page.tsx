"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type VerificationDoc } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function AdminPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [docs, setDocs] = useState<VerificationDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && (!user || user.role !== "ADMIN")) router.replace("/");
  }, [loading, user, router]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDocs(await api.adminListPendingDocs());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load review queue.");
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
      <h1>Verification review</h1>
      <p className="sub">Documents awaiting verification.</p>
      {error && <p className="error-text">{error}</p>}
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
