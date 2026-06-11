import Link from "next/link";

export const metadata = {
  title: "Pricing — Stabil",
};

const PLANS = [
  {
    name: "Candidate",
    price: "Free",
    period: "forever",
    blurb: "Everything you need to know and improve your own number.",
    cta: { label: "Get your score", href: "/score" },
    featured: false,
    features: [
      "Unlimited self-scoring & history",
      "Full explainable report",
      "Résumé prefill",
      "Document verification",
      "Share with explicit consent",
      "Export & delete your data",
    ],
  },
  {
    name: "Employer",
    price: "$49",
    period: "per seat / month",
    blurb: "For teams that screen with signal instead of gut feel.",
    cta: { label: "Start reviewing", href: "/register" },
    featured: true,
    features: [
      "Full candidate reports (with consent)",
      "Side-by-side comparison & ranking",
      "Sensitive-factor visibility",
      "Shared-with-you inbox",
      "Email notifications",
      "Priority support",
    ],
  },
  {
    name: "Teams",
    price: "Custom",
    period: "annual",
    blurb: "Recruiting agencies and high-volume hiring programs.",
    cta: { label: "Talk to us", href: "mailto:hello@stabil.dev" },
    featured: false,
    features: [
      "Everything in Employer",
      "Bulk candidate submission",
      "Claimable candidate profiles",
      "Admin verification queue",
      "API access",
      "Custom data agreements",
    ],
  },
];

export default function PricingPage() {
  return (
    <main>
      <p className="kicker">Pricing</p>
      <h1>Simple, honest pricing.</h1>
      <p className="sub">
        Candidates never pay to understand themselves. Employers pay for the lens.
        <em> Early access — prices indicative.</em>
      </p>

      <div className="price-grid">
        {PLANS.map((p) => (
          <div key={p.name} className={`card price-card${p.featured ? " featured" : ""}`}>
            {p.featured && <span className="price-flag">Most popular</span>}
            <h2>{p.name}</h2>
            <div className="price-figure">
              <span className="price-amount">{p.price}</span>
              <span className="price-period">{p.period}</span>
            </div>
            <p className="muted price-blurb">{p.blurb}</p>
            <ul className="price-features">
              {p.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            {p.cta.href.startsWith("mailto:") ? (
              <a href={p.cta.href} className={p.featured ? "btn" : "btn-secondary"}>
                {p.cta.label}
              </a>
            ) : (
              <Link href={p.cta.href} className={p.featured ? "btn" : "btn-secondary"}>
                {p.cta.label}
              </Link>
            )}
          </div>
        ))}
      </div>

      <p className="footer">
        Every plan includes consent-gated sharing, audience-aware reports, and full data
        rights (export &amp; delete). Questions? <a href="mailto:hello@stabil.dev">hello@stabil.dev</a>
      </p>
    </main>
  );
}
