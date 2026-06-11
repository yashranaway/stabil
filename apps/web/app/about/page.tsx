import Link from "next/link";

export const metadata = {
  title: "About — Stabil",
};

export default function AboutPage() {
  return (
    <main>
      <p className="kicker">About</p>
      <h1>
        Hiring runs on instinct. <em>We sell the instrument.</em>
      </h1>
      <p className="sub">
        Stabil began with a notebook sketch: could the scattered signals of a person&apos;s
        working life — tenure, academics, settledness, proof — be read on one honest dial?
      </p>

      <section className="section">
        <h2 className="section-title">What we believe</h2>
        <div className="grid">
          <div className="card">
            <h2>Determinism over vibes</h2>
            <p>
              The same inputs must produce the same score. Stabil&apos;s engine is fixed-weight
              and unit-tested — a measurement, not a mood.
            </p>
          </div>
          <div className="card">
            <h2>Explainability is a right</h2>
            <p>
              Anyone being scored deserves to see exactly which factors moved their number,
              and what would raise it. Every report itemises every point.
            </p>
          </div>
          <div className="card">
            <h2>Consent is the gate</h2>
            <p>
              Your report belongs to you. Employers see it only when you grant access, the
              grant expires, and revoking it works instantly.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">How the score is built</h2>
        <div className="card">
          <div className="ledger-line">
            <span className="ledger-key">Mode block</span>
            <span className="muted">
              Parameters specific to your path — academics &amp; projects for freshers; tenure
              &amp; experience for professionals.
            </span>
          </div>
          <div className="ledger-line">
            <span className="ledger-key">Common block</span>
            <span className="muted">
              Signals every profile shares — communication and settledness of location.
            </span>
          </div>
          <div className="ledger-line">
            <span className="ledger-key">Verification block</span>
            <span className="muted">
              Bonus points for documents an admin has actually verified. Proof beats claims.
            </span>
          </div>
          <div className="ledger-line total">
            <span className="ledger-key">Total</span>
            <span>
              0–1500, mapped to five tiers — from <strong>Unstable</strong> to{" "}
              <strong>Stable</strong>.
            </span>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 14 }}>
          Weights are openly placeholder until calibration completes — we&apos;d rather be
          honest than precise-sounding.
        </p>
      </section>

      <section className="cta-band">
        <h2>
          See your own ledger <em>first</em>.
        </h2>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link href="/score" className="btn btn-invert">
            Get your score
          </Link>
          <Link href="/security" className="btn-secondary btn-invert-ghost">
            Read how we protect it
          </Link>
        </div>
      </section>
    </main>
  );
}
