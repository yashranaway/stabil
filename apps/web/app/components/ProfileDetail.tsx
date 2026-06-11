"use client";

import { useCallback, useEffect, useState } from "react";

import {
  api,
  ApiError,
  type Report as ReportData,
  type ScoreRunSummary,
  type VerificationDoc,
} from "@/lib/api";
import { FresherForm } from "@/app/components/FresherForm";
import { ProfessionalForm } from "@/app/components/ProfessionalForm";
import { Report } from "@/app/components/Report";

import type { Mode } from "@stabil/scoring";
import type { FresherAnswers, ProfessionalAnswers, RawAnswers } from "@stabil/types";

/** Renders the correct intake form for the profile's mode and submits raw answers. */
export function ProfileScoreForm({
  mode,
  submitting,
  error,
  onSubmit,
}: {
  mode: Mode;
  submitting: boolean;
  error: string | null;
  onSubmit: (answers: RawAnswers) => void;
}) {
  const [resume, setResume] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<Partial<RawAnswers>>({});
  const [formKey, setFormKey] = useState(0);

  async function prefillFromResume() {
    setParsing(true);
    setParseError(null);
    try {
      const { suggestions } = await api.parseResume(resume);
      setPrefill(suggestions as Partial<RawAnswers>);
      setFormKey((k) => k + 1); // remount form so new defaults take effect
    } catch (err) {
      setParseError(err instanceof ApiError ? err.message : "Could not parse résumé.");
    } finally {
      setParsing(false);
    }
  }

  return (
    <div className="form-screen">
      <header className="report-header">
        <div>
          <h1>{mode === "fresher" ? "Fresher" : "Working Professional"} intake</h1>
          <p className="sub">Answer a few questions to compute this profile&apos;s stability score.</p>
        </div>
      </header>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Prefill from résumé (optional)</h2>
        <textarea
          rows={5}
          value={resume}
          onChange={(e) => setResume(e.target.value)}
          placeholder="Paste résumé text to auto-fill some fields…"
          style={{
            width: "100%",
            padding: 12,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--text)",
            fontFamily: "inherit",
          }}
        />
        {parseError && <p className="error-text">{parseError}</p>}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void prefillFromResume()}
          disabled={parsing || resume.trim().length < 20}
        >
          {parsing ? "Parsing…" : "Prefill from résumé"}
        </button>
      </div>

      {error && (
        <div className="alert-error" role="alert">
          {error}
        </div>
      )}

      {mode === "fresher" ? (
        <FresherForm
          key={formKey}
          submitting={submitting}
          prefill={prefill as Partial<FresherAnswers>}
          onSubmit={(a: FresherAnswers) => onSubmit(a)}
        />
      ) : (
        <ProfessionalForm
          key={formKey}
          submitting={submitting}
          prefill={prefill as Partial<ProfessionalAnswers>}
          onSubmit={(a: ProfessionalAnswers) => onSubmit(a)}
        />
      )}
    </div>
  );
}

/** Wraps the reused Report component and adds AI-generated suggestions from the report payload. */
export function ProfileReport({ report, onRescore }: { report: ReportData; onRescore: () => void }) {
  return (
    <>
      <div className="row no-print" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
        <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
          Save as PDF
        </button>
      </div>

      <Report result={report} onRestart={onRescore} />

      {report.suggestions.length > 0 && (
        <div className="card breakdown-card" style={{ marginTop: 16 }}>
          <h2>Suggestions</h2>
          <ul>
            {report.suggestions.map((s, i) => (
              <li key={i} style={{ marginBottom: 8 }}>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export function ProfileHistory({ runs }: { runs: ScoreRunSummary[] }) {
  if (runs.length === 0) {
    return (
      <div className="card">
        <h2>Score history</h2>
        <p className="muted" style={{ margin: 0 }}>
          No previous score runs.
        </p>
      </div>
    );
  }
  return (
    <div className="card">
      <h2>Score history</h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {runs.map((run) => (
          <li key={run.id} className="row" style={{ justifyContent: "space-between", padding: "8px 0" }}>
            <span>
              <strong>{run.total}</strong> <span className="muted">· {run.tier}</span>
            </span>
            <span className="muted">{new Date(run.createdAt).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProfileDocuments({ profileId }: { profileId: string }) {
  const [docs, setDocs] = useState<VerificationDoc[]>([]);
  const [kind, setKind] = useState("aadhaar");
  const [region, setRegion] = useState("IN");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDocs(await api.listDocuments(profileId));
    } catch {
      /* ignore list errors */
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { uploadUrl } = await api.submitDocument(profileId, { kind, region });
      if (file) {
        const put = await fetch(uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "content-type": file.type || "application/octet-stream" },
        });
        if (!put.ok) throw new Error(`Upload failed (HTTP ${put.status}).`);
      }
      setFile(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Could not submit document.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Verify documents</h2>
      <p className="muted">Approved documents raise your score (the verification bonus).</p>
      <div className="row">
        <select value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="IN">India</option>
          <option value="INTL">International</option>
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {region === "IN" ? (
            <>
              <option value="aadhaar">Aadhaar</option>
              <option value="pan">PAN</option>
            </>
          ) : (
            <>
              <option value="passport">Passport</option>
              <option value="national_id">National ID</option>
            </>
          )}
        </select>
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          style={{ width: "auto" }}
        />
        <button className="btn" onClick={() => void submit()} disabled={busy}>
          {busy ? "Submitting…" : "Submit for verification"}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {docs.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, marginTop: 12 }}>
          {docs.map((d) => (
            <li key={d.id} className="row" style={{ justifyContent: "space-between", padding: "6px 0" }}>
              <span>
                {d.kind} · {d.region}
              </span>
              <span className="muted">{d.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProfileShare({ profileId }: { profileId: string }) {
  const [granteeEmail, setGranteeEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await api.createShare({ profileId, granteeEmail, expiresInDays: 30 });
      setSuccess(`Shared with ${granteeEmail} for 30 days.`);
      setGranteeEmail("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not share this profile.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <h2>Share with an employer or recruiter</h2>
      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="granteeEmail">Email</label>
          <input
            id="granteeEmail"
            type="email"
            value={granteeEmail}
            onChange={(e) => setGranteeEmail(e.target.value)}
            placeholder="employer@company.com"
            required
          />
        </div>

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="status" role="status">
            <span className="dot ok" />
            {success}
          </p>
        )}

        <button type="submit" className="btn" disabled={submitting || granteeEmail.trim().length === 0}>
          {submitting ? "Sharing…" : "Share (30 days)"}
        </button>
      </form>
    </div>
  );
}
