import Link from "next/link";

const SPECIMEN_BARS = [
  { label: "Total experience", value: 280, max: 350 },
  { label: "Tenure", value: 250, max: 300 },
  { label: "Communication", value: 135, max: 150 },
  { label: "Verified documents", value: 150, max: 150 },
];

const FEATURES = [
  {
    k: "01",
    title: "Deterministic scoring",
    body: "A fixed-weight engine, not a vibe. The same answers produce the same 0–1500 score, every time — fully unit-tested.",
  },
  {
    k: "02",
    title: "Explainable by design",
    body: "Every point is attributed to a parameter you can see. No black boxes — the report shows exactly what moved the number.",
  },
  {
    k: "03",
    title: "Consent-first sharing",
    body: "Employers see a report only after the candidate explicitly shares it. Revoke any time; access ends immediately.",
  },
  {
    k: "04",
    title: "Audience-aware reports",
    body: "Sensitive factors are scored but never shown to candidates' viewers without rights — filtering is enforced server-side.",
  },
  {
    k: "05",
    title: "Résumé intelligence",
    body: "Paste a résumé and Stabil extracts experience, tenure, languages and projects to prefill your intake in seconds.",
  },
  {
    k: "06",
    title: "Verified evidence",
    body: "Upload identity documents for review. Approved documents add verification points — proof beats claims.",
  },
];

const TIERS = [
  { name: "Unstable", range: "0–499", cls: "t1" },
  { name: "Developing", range: "500–799", cls: "t2" },
  { name: "Somewhat stable", range: "800–1099", cls: "t3" },
  { name: "Settled", range: "1100–1349", cls: "t4" },
  { name: "Stable", range: "1350–1500", cls: "t5" },
];

const FAQS = [
  {
    q: "What exactly does Stabil measure?",
    a: "A role-agnostic stability signal: how settled, consistent and verifiable a person's profile is. It is one input for a human decision — never an automated verdict.",
  },
  {
    q: "Who can see my report?",
    a: "Only you, until you explicitly share it. Each share is a separate grant with an expiry, and you can revoke it at any moment from your account.",
  },
  {
    q: "How is the score computed?",
    a: "Your answers are normalised by a rubric into fractions, then a deterministic fixed-weight engine totals them across mode, common and verification blocks to a 0–1500 scale with five tiers.",
  },
  {
    q: "Can I improve my score?",
    a: "Yes — the report lists your biggest gaps and the exact points available, and re-scoring keeps your full history so you can track progress.",
  },
  {
    q: "Do freshers and professionals get compared?",
    a: "Both are scored on the same 0–1500 scale, but each mode has its own parameters — academics and projects for freshers, tenure and experience for professionals.",
  },
];

export default function Landing() {
  return (
    <main className="landing">
      {/* ---- hero ---- */}
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker">Stability, measured</p>
          <h1 className="hero-title">
            One honest number for how <em>stable</em> a person is.
          </h1>
          <p className="sub">
            Stabil scores candidates 0–1500 with a deterministic, explainable engine —
            built for employers, recruiters, and the candidates themselves.
          </p>
          <div className="row hero-cta">
            <Link href="/score" className="btn">
              Get your score — free
            </Link>
            <Link href="/register" className="btn-secondary">
              Create an account
            </Link>
          </div>
          <p className="hero-note muted">No sign-up needed to try it. Two minutes, no documents.</p>
        </div>

        <aside className="specimen card" aria-label="Sample stability report">
          <h2>Specimen report</h2>
          <div className="specimen-score">
            <span className="specimen-total">1105</span>
            <span className="specimen-of">/ 1500</span>
          </div>
          <span className="tier-badge specimen-tier">
            <span className="tier-badge-dot" /> Settled
          </span>
          {SPECIMEN_BARS.map((b) => (
            <div className="param-row" key={b.label}>
              <div className="param-head">
                <span className="param-label">{b.label}</span>
                <span className="param-value">
                  {b.value} / {b.max}
                </span>
              </div>
              <div className="param-track">
                <div className="param-fill" style={{ width: `${(b.value / b.max) * 100}%` }} />
              </div>
            </div>
          ))}
          <p className="specimen-foot muted">Deterministic · explainable · consent-gated</p>
        </aside>
      </section>

      {/* ---- ticker ---- */}
      <div className="ticker" aria-hidden>
        <span>0–1500 SCALE</span>
        <span>·</span>
        <span>5 TIERS</span>
        <span>·</span>
        <span>DETERMINISTIC ENGINE</span>
        <span>·</span>
        <span>CONSENT-FIRST</span>
        <span>·</span>
        <span>EXPLAINABLE</span>
        <span>·</span>
        <span>VERIFIED EVIDENCE</span>
      </div>

      {/* ---- how it works ---- */}
      <section className="section">
        <p className="kicker">How it works</p>
        <h2 className="section-title">Three steps to a number you can defend.</h2>
        <div className="steps">
          <div className="step">
            <span className="step-num">01</span>
            <h3>Answer or paste</h3>
            <p>
              Pick your mode — fresher or professional — and answer a short intake. Or paste
              your résumé and let Stabil prefill it.
            </p>
          </div>
          <div className="step">
            <span className="step-num">02</span>
            <h3>Get scored</h3>
            <p>
              The engine weighs every parameter across mode, common and verification blocks
              and returns your score, tier, and a full breakdown.
            </p>
          </div>
          <div className="step">
            <span className="step-num">03</span>
            <h3>Prove &amp; share</h3>
            <p>
              Verify documents for bonus points, then share the report with employers on
              your terms — every grant expires and can be revoked.
            </p>
          </div>
        </div>
      </section>

      {/* ---- tier scale ---- */}
      <section className="section">
        <p className="kicker">The scale</p>
        <h2 className="section-title">Five tiers. One ledger.</h2>
        <div className="tier-scale" role="img" aria-label="Score tiers from unstable to stable">
          {TIERS.map((t) => (
            <div key={t.name} className={`tier-cell ${t.cls}`}>
              <span className="tier-cell-name">{t.name}</span>
              <span className="tier-cell-range">{t.range}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ---- features ---- */}
      <section className="section">
        <p className="kicker">Why Stabil</p>
        <h2 className="section-title">Built like an instrument, not a quiz.</h2>
        <div className="grid feature-grid">
          {FEATURES.map((f) => (
            <div className="card feature" key={f.k}>
              <span className="feature-num">{f.k}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- for employers ---- */}
      <section className="section employer-band card">
        <div>
          <p className="kicker">For employers &amp; recruiters</p>
          <h2 className="section-title">Compare candidates on signal, not gut feel.</h2>
          <p className="sub" style={{ marginBottom: 20 }}>
            See full reports the moment a candidate shares one, rank consented candidates
            side by side, and read the exact factors behind every number.
          </p>
          <Link href="/register" className="btn">
            Start reviewing candidates
          </Link>
        </div>
      </section>

      {/* ---- FAQ ---- */}
      <section className="section">
        <p className="kicker">Questions</p>
        <h2 className="section-title">Fair questions, straight answers.</h2>
        <div className="faq">
          {FAQS.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ---- final CTA ---- */}
      <section className="cta-band">
        <h2>
          Know your number <em>before</em> they ask for it.
        </h2>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link href="/score" className="btn btn-invert">
            Score yourself now
          </Link>
          <Link href="/pricing" className="btn-secondary btn-invert-ghost">
            See pricing
          </Link>
        </div>
      </section>
    </main>
  );
}
