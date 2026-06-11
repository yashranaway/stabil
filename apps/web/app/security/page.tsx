import Link from "next/link";

export const metadata = {
  title: "Security & privacy — Stabil",
};

const PRACTICES = [
  {
    title: "Consent-gated access",
    body: "An employer or recruiter can open your report only while an active share grant from you exists. Grants carry an expiry, and revocation blocks access immediately — enforced at the API, not the UI.",
  },
  {
    title: "Audience-aware filtering",
    body: "Sensitive factors (like age and marital status) are stripped from candidate-facing views on the server. The filtering is part of the scoring engine's contract and covered by tests.",
  },
  {
    title: "Your data, your rights",
    body: "Export everything we hold about you in one click, or delete your account — deletion revokes every share, invalidates sessions, and soft-deletes your profiles in a single transaction.",
  },
  {
    title: "Credentials done properly",
    body: "Passwords are hashed with argon2id. Sessions use short-lived access tokens with rotating refresh tokens and reuse detection — a replayed token kills its whole family.",
  },
  {
    title: "Documents in private storage",
    body: "Identity documents go straight to private object storage via short-lived presigned URLs. Nothing is publicly readable; reviewers get time-boxed access.",
  },
  {
    title: "Rate-limited, structured errors",
    body: "The API is rate-limited and returns structured problem+json errors — no stack traces, no internals, no surprises.",
  },
];

export default function SecurityPage() {
  return (
    <main>
      <p className="kicker">Security &amp; privacy</p>
      <h1>
        A scoring product lives or dies on <em>trust</em>.
      </h1>
      <p className="sub">
        Stabil handles career and identity data, so privacy is not a settings page — it&apos;s
        the architecture. Here is exactly how it works.
      </p>

      <div className="grid feature-grid">
        {PRACTICES.map((p) => (
          <div className="card" key={p.title}>
            <h2>{p.title}</h2>
            <p>{p.body}</p>
          </div>
        ))}
      </div>

      <section className="section">
        <h2 className="section-title">Who sees what</h2>
        <div className="card">
          <div className="ledger-line">
            <span className="ledger-key">You</span>
            <span className="muted">
              Your full visible breakdown, score history, suggestions — plus a note that
              employer-only factors exist.
            </span>
          </div>
          <div className="ledger-line">
            <span className="ledger-key">Employers you approve</span>
            <span className="muted">
              The complete report, including employer-only factors — same total, fuller
              itemisation.
            </span>
          </div>
          <div className="ledger-line">
            <span className="ledger-key">Everyone else</span>
            <span className="muted">Nothing. There is no public profile and no directory.</span>
          </div>
        </div>
      </section>

      <section className="cta-band">
        <h2>
          Read it, then <em>test</em> it.
        </h2>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link href="/score" className="btn btn-invert">
            Score yourself
          </Link>
          <a href="mailto:security@stabil.dev" className="btn-secondary btn-invert-ghost">
            Report a vulnerability
          </a>
        </div>
      </section>
    </main>
  );
}
