"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { GoogleSignInButton } from "@/app/components/GoogleSignInButton";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Role = "CANDIDATE" | "EMPLOYER" | "RECRUITER";

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "CANDIDATE", label: "Candidate" },
  { value: "EMPLOYER", label: "Employer" },
  { value: "RECRUITER", label: "Recruiter" },
];

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("CANDIDATE");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await register({ name, email, password, role });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create your account. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <div className="form-card">
        <h1>Create your account</h1>
        <p className="sub">Get started with Stabil.</p>

        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="role">I am a…</label>
            <select id="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn" disabled={submitting}>
            {submitting ? "Creating…" : "Create account"}
          </button>
        </form>

        {googleError && (
          <p className="error-text" role="alert">
            {googleError}
          </p>
        )}
        <GoogleSignInButton onError={setGoogleError} redirectTo="/dashboard" />

        <p className="sub" style={{ marginTop: 24 }}>
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      </div>
    </main>
  );
}
