"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api, ApiError, type ParseResult } from "@/lib/api";
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
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  async function analyzeText() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.parseResume(text));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to parse resume.");
    } finally {
      setBusy(false);
    }
  }

  async function analyzePdf() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.parseResumeFile(file));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to parse PDF.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return <main>Loading…</main>;

  const entries = result ? Object.entries(result.suggestions) : [];
  const extractedLangs = (result?.extracted.programmingLanguages as string[] | undefined) ?? [];

  return (
    <main>
      <h1>Resume analyzer</h1>
      <p className="sub">
        Upload a PDF résumé — or paste the text — and Stabil&apos;s AI extracts structured
        signals to prefill your profile. Works for any account role.
      </p>

      <div className="card">
        <h2>Upload a PDF</h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: 14 }}>
          The résumé bytes are parsed server-side and run through the same AI pipeline as
          pasted text.
        </p>
        <div className="row">
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button className="btn" onClick={() => void analyzePdf()} disabled={busy || !file}>
            {busy ? "Analyzing…" : "Analyze PDF"}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Or paste résumé text</h2>
        <div className="field" style={{ marginTop: 4 }}>
          <textarea
            id="resume"
            rows={8}
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
        <button className="btn" onClick={() => void analyzeText()} disabled={busy || text.trim().length < 20}>
          {busy ? "Analyzing…" : "Analyze text"}
        </button>
      </div>

      {error && (
        <p className="error-text" style={{ marginTop: 16 }}>
          {error}
        </p>
      )}

      {result && (
        <div className="card" style={{ marginTop: 24 }}>
          <h2>What the AI read from this résumé</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Confidence: {Math.round((result.extracted.confidence as number) * 100)}%
            {extractedLangs.length > 0 && <> · Languages detected: {extractedLangs.join(", ")}</>}
          </p>

          {entries.length === 0 ? (
            <p className="muted">No clear signals found — try a more detailed résumé.</p>
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
