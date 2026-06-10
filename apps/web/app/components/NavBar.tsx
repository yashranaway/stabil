"use client";

import Link from "next/link";

import { useAuth } from "@/lib/auth";

export function NavBar() {
  const { user, loading, logout } = useAuth();

  return (
    <nav className="nav">
      <Link href="/" className="brand">
        Stabil
      </Link>
      <div className="nav-links">
        {loading ? null : user ? (
          <>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/parse">Resume analyzer</Link>
            {(user.role === "EMPLOYER" || user.role === "RECRUITER") && (
              <>
                <Link href="/shared">Shared with me</Link>
                <Link href="/compare">Compare</Link>
              </>
            )}
            <Link href="/account">Account</Link>
            <button type="button" className="link-btn" onClick={() => void logout()}>
              Log out
            </button>
          </>
        ) : (
          <>
            <Link href="/login">Log in</Link>
            <Link href="/register">Sign up</Link>
          </>
        )}
      </div>
    </nav>
  );
}
