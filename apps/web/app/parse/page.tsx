"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const FIELD_LABELS: Record<string, string> = {
  totalExperienceYears: "Total experience (years)",
  averageTenureMonths: "Average tenure (months)",
  academicsPercentage: "Academics (%)",
  projectsCount: "Projects",
  programmingLanguagesCount: "Programming languages",
  spokenLanguagesCount: "Spoken languages",
  certificationsCount: "Certifications",
};

export default function ParsePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  async function analyze() {
    setBusy(true);
    setError(null);
    setSuggestions(null);
    try {
      const res = await api.parseResume(text);
      setSuggestions(res.suggestions);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to parse resume.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return <main>Loading…</main>;

  const entries = suggestions ? Object.entries(suggestions) : [];

  return (
    <main>
      <h1>Resume analyzer</h1>
      <p className="sub">
        Paste your resume text. We extract structured signals you can use to fill your
        profile faster. (Powered by the configured AI provider; a deterministic fallback
        runs without an API key.)
      </p>

      <div className="field">
        <label htmlFor="resume">Resume text</label>
        <textarea
          id="resume"
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste your resume here (min ~20 characters)…"
          style={{
            width: "100%",
            padding: "12px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            color: "var(--text)",
            fontFamily: "inherit",
          }}
        />
      </div>

      <button className="btn" onClick={() => void analyze()} disabled={busy || text.trim().length < 20}>
        {busy ? "Analyzing…" : "Analyze resume"}
      </button>

      {error && <p className="error-text">{error}</p>}

      {suggestions && (
        <div className="card" style={{ marginTop: 24 }}>
          <h2>Suggested values</h2>
          {entries.length === 0 ? (
            <p className="muted">No clear signals found — try a more detailed resume.</p>
          ) : (
            <div className="grid">
              {entries.map(([key, value]) => (
                <div key={key} className="card">
                  <h2>{FIELD_LABELS[key] ?? key}</h2>
                  <div className="status">{value}</div>
                </div>
              ))}
            </div>
          )}
          <p className="footer">
            Use these to fill your profile form on the <a href="/dashboard">dashboard</a>.
          </p>
        </div>
      )}
    </main>
  );
}
