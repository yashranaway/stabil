import { Injectable } from "@nestjs/common";
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { createElement as h } from "react";

interface ReportLike {
  total: number;
  maxTotal: number;
  tier: string;
  breakdown: { label: string; awarded: number; max: number }[];
  profile: { displayName: string };
}

@Injectable()
export class PdfService {
  async render(r: ReportLike): Promise<Buffer> {
    const s = StyleSheet.create({
      page: { padding: 44, fontSize: 11, color: "#16140f", fontFamily: "Helvetica" },
      brand: { fontSize: 10, letterSpacing: 2, color: "#6b6452", marginBottom: 18 },
      name: { fontSize: 22, marginBottom: 2 },
      score: { fontSize: 44, marginTop: 14 },
      tier: { fontSize: 12, color: "#555", marginBottom: 24, textTransform: "uppercase" },
      section: { fontSize: 9, letterSpacing: 1.5, color: "#6b6452", marginTop: 18, marginBottom: 6 },
      row: {
        flexDirection: "row",
        justifyContent: "space-between",
        borderBottom: "1px solid #eee",
        paddingTop: 5,
        paddingBottom: 5,
      },
      val: { color: "#555" },
    });

    const doc = h(
      Document,
      null,
      h(
        Page,
        { size: "A4", style: s.page },
        h(Text, { style: s.brand }, "STABIL · STABILITY REPORT"),
        h(Text, { style: s.name }, r.profile.displayName),
        h(Text, { style: s.score }, `${r.total} / ${r.maxTotal}`),
        h(Text, { style: s.tier }, `Tier — ${r.tier}`),
        h(Text, { style: s.section }, "PER-PARAMETER BREAKDOWN"),
        ...r.breakdown.map((b, i) =>
          h(
            View,
            { key: String(i), style: s.row },
            h(Text, null, b.label),
            h(Text, { style: s.val }, `${b.awarded} / ${b.max}`),
          ),
        ),
      ),
    );

    return renderToBuffer(doc);
  }
}
