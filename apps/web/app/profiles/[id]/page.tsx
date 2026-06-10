"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type Profile, type Report as ReportData, type ScoreRunSummary } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  ProfileHistory,
  ProfileReport,
  ProfileScoreForm,
  ProfileShare,
} from "@/app/components/ProfileDetail";

import type { RawAnswers } from "@stabil/types";

export default function ProfilePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user, loading: authLoading } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [runs, setRuns] = useState<ScoreRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scoring, setScoring] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  // Toggle that forces the intake form even when a report already exists (re-score).
  const [rescoring, setRescoring] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const prof = await api.getProfile(id);
      setProfile(prof);

      const [reportResult, runsResult] = await Promise.allSettled([
        api.getReport(id),
        api.listScoreRuns(id),
      ]);

      setReport(reportResult.status === "fulfilled" ? reportResult.value : null);
      setRuns(runsResult.status === "fulfilled" ? runsResult.value : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this profile.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (user) void loadAll();
  }, [user, loadAll]);

  async function submitScore(answers: RawAnswers) {
    setScoring(true);
    setScoreError(null);
    try {
      await api.scoreProfile(id, answers);
      setReport(await api.getReport(id));
      setRuns(await api.listScoreRuns(id));
      setRescoring(false);
    } catch (err) {
      setScoreError(err instanceof ApiError ? err.message : "Could not score this profile.");
    } finally {
      setScoring(false);
    }
  }

  if (authLoading || !user) {
    return (
      <main>
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main>
        <p className="muted">Loading profile…</p>
      </main>
    );
  }

  if (error || !profile) {
    return (
      <main>
        <p className="error-text" role="alert">
          {error ?? "Profile not found."}
        </p>
        <p>
          <Link href="/dashboard">Back to dashboard</Link>
        </p>
      </main>
    );
  }

  const showForm = !report || rescoring;

  return (
    <main>
      <p className="sub" style={{ marginBottom: 8 }}>
        <Link href="/dashboard">← Back to dashboard</Link>
      </p>

      {showForm ? (
        <>
          {report && (
            <p className="row" style={{ marginBottom: 16 }}>
              <button type="button" className="btn-secondary btn" onClick={() => setRescoring(false)}>
                Cancel re-score
              </button>
            </p>
          )}
          <ProfileScoreForm
            mode={profile.mode}
            submitting={scoring}
            error={scoreError}
            onSubmit={(a) => void submitScore(a)}
          />
        </>
      ) : (
        <>
          <ProfileReport report={report} onRescore={() => setRescoring(true)} />
          <div className="row" style={{ marginTop: 16 }}>
            <button type="button" className="btn" onClick={() => setRescoring(true)}>
              Re-score this profile
            </button>
          </div>
        </>
      )}

      <div className="grid" style={{ marginTop: 32 }}>
        <ProfileHistory runs={runs} />
        <ProfileShare profileId={id} />
      </div>
    </main>
  );
}
