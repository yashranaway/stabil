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

export function AccountShareRow({
  grant,
  onRevoke,
  revoking,
}: {
  grant: ShareGrant;
  onRevoke: () => void;
  revoking: boolean;
}) {
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>{grant.granteeEmail}</strong>
          <p className="muted" style={{ margin: "8px 0 0", fontSize: "0.85rem" }}>
            <span className="status">
              <span className={`dot ${STATUS_CLASS[grant.status]}`} />
              {grant.status}
            </span>
            <span style={{ marginLeft: 12 }}>Expires {formatExpiry(grant.expiresAt)}</span>
          </p>
        </div>
        {grant.status === "ACTIVE" && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onRevoke}
            disabled={revoking}
          >
            {revoking ? "Revoking…" : "Revoke"}
          </button>
        )}
      </div>
    </div>
  );
}
