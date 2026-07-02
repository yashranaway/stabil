"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth";

interface GoogleCredentialResponse {
  credential: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

/**
 * Renders Google's own "Sign in with Google" button via Google Identity
 * Services. Silently renders nothing if NEXT_PUBLIC_GOOGLE_CLIENT_ID isn't
 * configured, so the feature stays fully optional.
 */
export function GoogleSignInButton({
  onError,
  redirectTo = "/dashboard",
}: {
  onError?: (message: string) => void;
  redirectTo?: string;
}) {
  const { loginWithGoogle } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);

  const handleCredential = useCallback(
    async (response: GoogleCredentialResponse) => {
      try {
        await loginWithGoogle(response.credential);
        window.location.href = redirectTo;
      } catch {
        onError?.("Google sign-in failed. Please try again.");
      }
    },
    [loginWithGoogle, onError, redirectTo],
  );

  useEffect(() => {
    if (!scriptReady || !CLIENT_ID || !window.google || !containerRef.current) return;
    window.google.accounts.id.initialize({ client_id: CLIENT_ID, callback: handleCredential });
    window.google.accounts.id.renderButton(containerRef.current, {
      type: "standard",
      theme: "outline",
      size: "large",
      shape: "pill",
      width: 320,
      text: "continue_with",
    });
  }, [scriptReady, handleCredential]);

  if (!CLIENT_ID) return null;

  return (
    <div className="google-signin">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />
      <div className="divider-or">
        <span>or</span>
      </div>
      <div ref={containerRef} />
    </div>
  );
}
