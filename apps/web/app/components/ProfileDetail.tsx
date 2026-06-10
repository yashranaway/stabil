"use client";

import { useState } from "react";

import { api, ApiError, type Report as ReportData, type ScoreRunSummary } from "@/lib/api";
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
  return (
    <div className="form-screen">
      <header className="report-header">
        <div>
          <h1>{mode === "fresher" ? "Fresher" : "Working Professional"} intake</h1>
          <p className="sub">Answer a few questions to compute this profile&apos;s stability score.</p>
        </div>
      </header>

      {error && (
        <div className="alert-error" role="alert">
          {error}
        </div>
      )}

      {mode === "fresher" ? (
        <FresherForm submitting={submitting} onSubmit={(a: FresherAnswers) => onSubmit(a)} />
      ) : (
        <ProfessionalForm submitting={submitting} onSubmit={(a: ProfessionalAnswers) => onSubmit(a)} />
      )}
    </div>
  );
}

/** Wraps the reused Report component and adds AI-generated suggestions from the report payload. */
export function ProfileReport({ report, onRescore }: { report: ReportData; onRescore: () => void }) {
  return (
    <>
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
