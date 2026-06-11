"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api, ApiError, type Profile } from "@/lib/api";
import { TierBadge } from "@/app/components/TierBadge";

import type { Tier } from "@stabil/scoring";

const MODE_LABEL: Record<Profile["mode"], string> = {
  fresher: "Fresher",
  professional: "Working Professional",
};

export function DashboardProfileCard({ profile }: { profile: Profile }) {
  const score = profile.latestScoreRun;
  return (
    <Link href={`/profiles/${profile.id}`} className="card" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
      <h2>{MODE_LABEL[profile.mode]}</h2>
      <p style={{ fontSize: "1.1rem", fontWeight: 600, margin: "0 0 12px" }}>{profile.displayName}</p>
      {score ? (
        <div className="row">
          <TierBadge tier={score.tier as Tier} />
          <span className="muted">
            {score.total} pts
          </span>
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          Not scored yet
        </p>
      )}
    </Link>
  );
}

export function DashboardCreateProfile({ onCreated }: { onCreated: (profile: Profile) => void }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [mode, setMode] = useState<Profile["mode"]>("fresher");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createProfile({ displayName, mode });
      onCreated(created);
      setDisplayName("");
      router.push(`/profiles/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the profile. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <h2>Create a profile</h2>
      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="displayName">Display name</label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Jane Doe"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="mode">Mode</label>
          <select id="mode" value={mode} onChange={(e) => setMode(e.target.value as Profile["mode"])}>
            <option value="fresher">Fresher</option>
            <option value="professional">Working Professional</option>
          </select>
        </div>

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn" disabled={submitting || displayName.trim().length === 0}>
          {submitting ? "Creating…" : "Create profile"}
        </button>
      </form>
    </div>
  );
}
