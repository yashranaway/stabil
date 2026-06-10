"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type Notification } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function describe(n: Notification): string {
  if (n.kind === "verification_result") {
    const status = String(n.payload.status ?? "").toLowerCase();
    const kind = String(n.payload.kind ?? "document");
    return `Your ${kind} document was ${status}.`;
  }
  return n.kind;
}

export default function NotificationsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.listNotifications());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load notifications.");
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  async function markRead(id: string) {
    await api.markNotificationRead(id);
    await load();
  }

  if (loading || !user) return <main>Loading…</main>;

  return (
    <main>
      <h1>Notifications</h1>
      {error && <p className="error-text">{error}</p>}
      {!items ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted">No notifications yet.</p>
      ) : (
        <div className="grid">
          {items.map((n) => (
            <div key={n.id} className="card" style={{ opacity: n.readAt ? 0.6 : 1 }}>
              <h2>{n.readAt ? "Read" : "New"}</h2>
              <p>{describe(n)}</p>
              {!n.readAt && (
                <button className="btn btn-secondary" onClick={() => void markRead(n.id)}>
                  Mark read
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
