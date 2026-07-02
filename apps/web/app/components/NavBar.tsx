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
            {user.role === "ADMIN" && <Link href="/admin">Admin</Link>}
            <Link href="/notifications">Notifications</Link>
            <Link href="/account">Account</Link>
            <button type="button" className="link-btn" onClick={() => void logout()}>
              Log out
            </button>
          </>
        ) : (
          <>
            <Link href="/pricing">Pricing</Link>
            <Link href="/about">About</Link>
            <Link href="/security">Security</Link>
            <Link href="/login" className="nav-btn nav-btn-ghost">
              Log in
            </Link>
            <Link href="/score" className="nav-btn nav-btn-ghost">
              Get your score
            </Link>
            <Link href="/register" className="nav-btn nav-btn-primary">
              Sign up
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
