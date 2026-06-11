import type { Metadata } from "next";
import { Instrument_Serif, JetBrains_Mono, Schibsted_Grotesk } from "next/font/google";

import { NavBar } from "@/app/components/NavBar";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

const display = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});
const sans = Schibsted_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Stabil — stability, measured",
  description: "Score how stable a person is (0–1500). An explainable stability instrument.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <AuthProvider>
          <NavBar />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
