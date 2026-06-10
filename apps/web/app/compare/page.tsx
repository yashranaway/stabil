"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type Report } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Row {
  profileId: string;
  name: string;
  total: number;
  maxTotal: number;
  tier: string;
  metrics: Record<string, number>;
}

// Columns shown in the comparison grid (keys present in the employer breakdown).
const COLUMNS: { key: string; label: string }[] = [
  { key: "totalExperience", label: "Experience" },
  { key: "tenure", label: "Tenure" },
  { key: "communication", label: "Comms" },
  { key: "age", label: "Age" },
  { key: "maritalStatus", label: "Marital" },
  { key: "verifiedDocuments", label: "Verified" },
];

export default function ComparePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const grants = await api.listSharedToMe();
      const unique = [...new Map(grants.map((g) => [g.profileId, g])).values()];
      const reports = await Promise.allSettled(unique.map((g) => api.getReport(g.profileId)));
      const built: Row[] = [];
      for (const r of reports) {
        if (r.status !== "fulfilled") continue;
        const rep: Report = r.value;
        const metrics: Record<string, number> = {};
        for (const b of rep.breakdown) metrics[b.key] = b.awarded;
        built.push({
          profileId: rep.profile.id,
          name: rep.profile.displayName,
          total: rep.total,
          maxTotal: rep.maxTotal,
          tier: rep.tier,
          metrics,
        });
      }
      built.sort((a, b) => b.total - a.total); // rank by score
      setRows(built);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load candidates.");
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (loading || !user) return <main>Loading…</main>;

  return (
    <main>
      <h1>Compare candidates</h1>
      <p className="sub">Candidates who have shared their report with you, ranked by stability score.</p>

      {error && <p className="error-text">{error}</p>}
      {!rows ? (
        <p className="muted">Loading candidates…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No candidates have shared a report with you yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr>
                <th style={th}>#</th>
                <th style={th}>Candidate</th>
                <th style={th}>Score</th>
                <th style={th}>Tier</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} style={th}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.profileId}>
                  <td style={td}>{i + 1}</td>
                  <td style={td}>{row.name}</td>
                  <td style={{ ...td, fontWeight: 700 }}>
                    {row.total}
                    <span className="muted"> / {row.maxTotal}</span>
                  </td>
                  <td style={td}>{row.tier}</td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} style={td}>
                      {row.metrics[c.key] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
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
