export const dynamic = "force-dynamic";

type ApiHealth = { status: string; service: string; db: "up" | "down" };

async function getApiHealth(): Promise<{ ok: boolean; data?: ApiHealth; error?: string }> {
  const base = process.env.API_URL ?? "http://localhost:3001";
  try {
    const res = await fetch(`${base}/health`, { cache: "no-store" });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, data: (await res.json()) as ApiHealth };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unreachable" };
  }
}

function Status({ up, label }: { up: boolean; label: string }) {
  return (
    <span className="status">
      <span className={`dot ${up ? "ok" : "down"}`} />
      {label}
    </span>
  );
}

export default async function Home() {
  const api = await getApiHealth();
  const apiUp = api.ok && api.data?.status === "ok";
  const dbUp = api.ok && api.data?.db === "up";

  return (
    <main>
      <h1>Stabil</h1>
      <p className="sub">Stability-check platform — Phase 0 foundation is live.</p>

      <div className="grid">
        <div className="card">
          <h2>Web</h2>
          <Status up label="running" />
        </div>
        <div className="card">
          <h2>API</h2>
          <Status up={apiUp} label={apiUp ? "running" : api.error ?? "down"} />
        </div>
        <div className="card">
          <h2>Database</h2>
          <Status up={dbUp} label={dbUp ? "connected" : "down"} />
        </div>
      </div>

      <p className="footer">
        Web → API → Postgres wired via Docker Compose. Next: the scoring API + report UI
        (Phase 1). See <code>docs/phases/phase-1-core-scoring.md</code>.
      </p>
    </main>
  );
}
