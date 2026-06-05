import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Stabil",
  description: "Stability-check platform — score how stable a person is (0–1500).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
