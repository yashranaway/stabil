"use client";

import type { ShareGrant } from "@/lib/api";

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const STATUS_CLASS: Record<ShareGrant["status"], string> = {
  ACTIVE: "ok",
  REVOKED: "down",
  EXPIRED: "down",
};

export function SharedGrantCard({
  grant,
  selected,
  onSelect,
}: {
  grant: ShareGrant;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="card"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        textAlign: "left",
        cursor: "pointer",
        width: "100%",
        borderColor: selected ? "var(--accent)" : undefined,
        color: "var(--text)",
      }}
    >
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{grant.granteeEmail}</strong>
        <span className="status">
          <span className={`dot ${STATUS_CLASS[grant.status]}`} />
          {grant.status}
        </span>
      </div>
      <p className="muted" style={{ margin: "8px 0 0", fontSize: "0.85rem" }}>
        Expires {formatExpiry(grant.expiresAt)}
      </p>
    </button>
  );
}
