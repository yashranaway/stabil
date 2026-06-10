"use client";

import { useMemo } from "react";

import type { AudienceScoreResult, ParameterScore } from "@stabil/scoring";

import { tierBlurb } from "../../lib/tier";
import { ScoreGauge } from "./ScoreGauge";
import { TierBadge } from "./TierBadge";

const BLOCK_LABEL: Record<ParameterScore["block"], string> = {
  mode: "Mode block",
  common: "Common block",
  verification: "Verification block",
};

function ParameterBar({ param }: { param: ParameterScore }) {
  const pct = param.max > 0 ? Math.round((param.awarded / param.max) * 100) : 0;
  return (
    <li className="param-row">
      <div className="param-head">
        <span className="param-label">{param.label}</span>
        <span className="param-value">
          {param.awarded} / {param.max}
        </span>
      </div>
      <div
        className="param-track"
        role="meter"
        aria-valuenow={param.awarded}
        aria-valuemin={0}
        aria-valuemax={param.max}
        aria-label={`${param.label}: ${param.awarded} of ${param.max}`}
      >
        <div className="param-fill" style={{ width: `${pct}%` }} />
      </div>
    </li>
  );
}

/** Pick up to two visible parameters with the most headroom to suggest improving. */
function improvementHints(breakdown: readonly ParameterScore[]) {
  return [...breakdown]
    .map((p) => ({ ...p, gap: p.max - p.awarded }))
    .filter((p) => p.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 2);
}

export function Report({
  result,
  onRestart,
}: {
  result: AudienceScoreResult;
  onRestart: () => void;
}) {
  const grouped = useMemo(() => {
    const order: ParameterScore["block"][] = ["mode", "common", "verification"];
    return order
      .map((block) => ({
        block,
        items: result.breakdown.filter((p) => p.block === block),
      }))
      .filter((g) => g.items.length > 0);
  }, [result.breakdown]);

  const hints = useMemo(() => improvementHints(result.breakdown), [result.breakdown]);

  return (
    <section className="report" aria-label="Stability report">
      <header className="report-header">
        <div>
          <h1>Your stability report</h1>
          <p className="sub">
            Scored as a {result.mode === "fresher" ? "Fresher" : "Working Professional"}.
          </p>
        </div>
        <button type="button" className="btn-ghost" onClick={onRestart}>
          Start over
        </button>
      </header>

      <div className="report-top">
        <div className="card gauge-card">
          <ScoreGauge result={result} />
          <div className="gauge-meta">
            <TierBadge tier={result.tier} />
            <p className="gauge-blurb">{tierBlurb[result.tier]}</p>
            <p className="gauge-total">
              <strong>{result.total}</strong>
              <span className="muted"> / {result.maxTotal}</span>
            </p>
            {result.hiddenParameterCount > 0 && (
              <p className="hidden-note">
                Your score also includes {result.hiddenParameterCount} factor
                {result.hiddenParameterCount === 1 ? "" : "s"} visible to employers only.
              </p>
            )}
          </div>
        </div>

        {hints.length > 0 && (
          <div className="card hints-card">
            <h2>Improve your score</h2>
            <ul className="hints">
              {hints.map((h) => (
                <li key={h.key} className="hint">
                  <span className="hint-gain">+{h.gap}</span>
                  <span className="hint-text">
                    Strengthen <strong>{h.label}</strong> — currently {h.awarded} of {h.max}.
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="card breakdown-card">
        <h2>Per-parameter breakdown</h2>
        {grouped.map((group) => (
          <div key={group.block} className="param-group">
            <h3 className="param-group-title">{BLOCK_LABEL[group.block]}</h3>
            <ul className="param-list">
              {group.items.map((p) => (
                <ParameterBar key={p.key} param={p} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
