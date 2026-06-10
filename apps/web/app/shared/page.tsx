"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { api, ApiError } from "@/lib/api";
import type { Report as ReportData, ShareGrant } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Report } from "@/app/components/Report";
import { SharedGrantCard } from "@/app/components/SharedGrantCard";

export default function SharedPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [grants, setGrants] = useState<ShareGrant[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (authLoading || !user) return;
    let active = true;
    (async () => {
      try {
        const data = await api.listSharedToMe();
        if (active) setGrants(data);
      } catch (err) {
        if (active) {
          setListError(err instanceof Error ? err.message : "Could not load shared reports.");
          setGrants([]);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [authLoading, user]);

  async function selectGrant(grant: ShareGrant) {
    setSelectedId(grant.id);
    setReport(null);
    setReportError(null);
    setReportLoading(true);
    try {
      const data = await api.getReport(grant.profileId);
      setReport(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setReportError("This share has been revoked or has expired, so the report is no longer available.");
      } else {
        setReportError(err instanceof Error ? err.message : "Could not load this report.");
      }
    } finally {
      setReportLoading(false);
    }
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
      <h1>Shared with me</h1>
      <p className="sub">Stability reports that candidates have shared with you.</p>

      {grants === null && !listError && <p className="muted">Loading shared reports…</p>}

      {listError && (
        <p className="error-text" role="alert">
          {listError}
        </p>
      )}

      {grants !== null && grants.length === 0 && !listError && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No candidates have shared a report with you yet.
          </p>
        </div>
      )}

      {grants !== null && grants.length > 0 && (
        <div className="grid">
          {grants.map((grant) => (
            <SharedGrantCard
              key={grant.id}
              grant={grant}
              selected={selectedId === grant.id}
              onSelect={() => void selectGrant(grant)}
            />
          ))}
        </div>
      )}

      {selectedId && (
        <div style={{ marginTop: 32 }}>
          {reportLoading && <p className="muted">Loading report…</p>}
          {reportError && (
            <p className="error-text" role="alert">
              {reportError}
            </p>
          )}
          {report && (
            <Report
              result={report}
              onRestart={() => {
                setSelectedId(null);
                setReport(null);
                setReportError(null);
              }}
            />
          )}
        </div>
      )}
    </main>
  );
}
