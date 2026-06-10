"use client";

import "../../lib/charts/register";

import type { Chart, ChartData, ChartOptions, Plugin } from "chart.js";
import { useMemo } from "react";
import { Doughnut } from "react-chartjs-2";

import type { AudienceScoreResult } from "@stabil/scoring";

import { tierColor, tierLabel } from "../../lib/tier";

const TRACK = "#26304a";
const FG = "#e6e9f2";
const MUTED = "#9aa4bf";

function toGaugeData(result: AudienceScoreResult): ChartData<"doughnut"> {
  const filled = Math.max(0, Math.min(result.total, result.maxTotal));
  const remainder = Math.max(0, result.maxTotal - filled);
  return {
    labels: ["Score", "Remaining"],
    datasets: [
      {
        data: [filled, remainder],
        backgroundColor: [tierColor[result.tier], TRACK],
        borderWidth: 0,
        circumference: 270,
        rotation: 225,
      },
    ],
  };
}

const gaugeOptions: ChartOptions<"doughnut"> = {
  responsive: true,
  maintainAspectRatio: false,
  rotation: 225,
  circumference: 270,
  cutout: "78%",
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
};

/** Draws the score + tier label inside the doughnut hole. */
function centerLabelPlugin(result: AudienceScoreResult): Plugin<"doughnut"> {
  return {
    id: "centerLabel",
    afterDraw(chart: Chart) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const cx = chartArea.left + chartArea.width / 2;
      const cy = chartArea.top + chartArea.height * 0.6;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.fillStyle = FG;
      ctx.font =
        '700 36px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(`${result.total}`, cx, cy);

      ctx.fillStyle = MUTED;
      ctx.font =
        '400 13px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(`of ${result.maxTotal}`, cx, cy + 26);

      ctx.fillStyle = tierColor[result.tier];
      ctx.font =
        '600 14px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(tierLabel[result.tier], cx, cy + 46);
      ctx.restore();
    },
  };
}

export function ScoreGauge({ result }: { result: AudienceScoreResult }) {
  const data = useMemo(() => toGaugeData(result), [result]);
  const plugins = useMemo(() => [centerLabelPlugin(result)], [result]);

  return (
    <div
      className="gauge"
      role="img"
      aria-label={`Overall stability score ${result.total} of ${result.maxTotal}, tier ${tierLabel[result.tier]}.`}
    >
      <Doughnut data={data} options={gaugeOptions} plugins={plugins} />
    </div>
  );
}
