"use client";

import { useState } from "react";

import type { AudienceScoreResult, Mode } from "@stabil/scoring";
import type { FresherAnswers, ProfessionalAnswers, RawAnswers } from "@stabil/types";

import { scoreAnswers } from "../../lib/api";
import { FresherForm } from "./FresherForm";
import { ProfessionalForm } from "./ProfessionalForm";
import { Report } from "./Report";

type Stage =
  | { kind: "mode" }
  | { kind: "form"; mode: Mode }
  | { kind: "result"; result: AudienceScoreResult };

function ModeSelection({ onPick }: { onPick: (mode: Mode) => void }) {
  return (
    <div className="mode-select">
      <h1>How would you describe your status?</h1>
      <p className="sub">Your mode decides which questions appear and how you&apos;re scored.</p>
      <div className="mode-grid">
        <button type="button" className="mode-card" onClick={() => onPick("fresher")}>
          <span className="mode-kicker">Mode 01</span>
          <span className="mode-title">Fresher</span>
          <span className="mode-desc">
            New graduate or up to ~1 year of experience. Scored on potential, academics
            &amp; skills.
          </span>
          <span className="mode-cta">Select</span>
        </button>
        <button type="button" className="mode-card" onClick={() => onPick("professional")}>
          <span className="mode-kicker">Mode 02</span>
          <span className="mode-title">Working Professional</span>
          <span className="mode-desc">
            Currently employed or with meaningful work history. Scored on tenure,
            experience &amp; settledness.
          </span>
          <span className="mode-cta">Select</span>
        </button>
      </div>
    </div>
  );
}

export function ScoreFlow() {
  const [stage, setStage] = useState<Stage>({ kind: "mode" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(answers: RawAnswers) {
    setSubmitting(true);
    setError(null);
    try {
      const result = await scoreAnswers(answers);
      setStage({ kind: "result", result });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (stage.kind === "result") {
    return <Report result={stage.result} onRestart={() => setStage({ kind: "mode" })} />;
  }

  if (stage.kind === "form") {
    return (
      <div className="form-screen">
        <header className="report-header">
          <div>
            <h1>{stage.mode === "fresher" ? "Fresher" : "Working Professional"} intake</h1>
            <p className="sub">Answer a few questions to get your stability score.</p>
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setStage({ kind: "mode" })}
          >
            Change mode
          </button>
        </header>

        {error && <div className="alert-error" role="alert">{error}</div>}

        {stage.mode === "fresher" ? (
          <FresherForm
            submitting={submitting}
            onSubmit={(a: FresherAnswers) => submit(a)}
          />
        ) : (
          <ProfessionalForm
            submitting={submitting}
            onSubmit={(a: ProfessionalAnswers) => submit(a)}
          />
        )}
      </div>
    );
  }

  return <ModeSelection onPick={(mode) => setStage({ kind: "form", mode })} />;
}
