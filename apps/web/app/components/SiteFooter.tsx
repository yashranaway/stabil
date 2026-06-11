import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <span className="brand">Stabil</span>
          <p className="muted">Stability, measured. 0–1500, explained.</p>
        </div>
        <nav className="site-footer-cols" aria-label="Footer">
          <div>
            <h3>Product</h3>
            <Link href="/score">Get your score</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/register">Create account</Link>
          </div>
          <div>
            <h3>Company</h3>
            <Link href="/about">About</Link>
            <Link href="/security">Security &amp; privacy</Link>
            <a href="mailto:hello@stabil.dev">Contact</a>
          </div>
          <div>
            <h3>Candidates</h3>
            <Link href="/login">Log in</Link>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/parse">Résumé analyzer</Link>
          </div>
        </nav>
      </div>
      <div className="site-footer-line">
        <span>© {new Date().getFullYear()} Stabil</span>
        <span>SCORES ARE DECISION SUPPORT — NEVER AN AUTOMATED VERDICT</span>
      </div>
    </footer>
  );
}
