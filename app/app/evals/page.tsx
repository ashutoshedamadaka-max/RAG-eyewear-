import type { Metadata } from "next";
import { loadEvalSummary, loadGoldenCaseCounts, loadCaseMatrix } from "@/lib/eval-reports";
import EvalsPageClient from "@/components/EvalsPageClient";

export const metadata: Metadata = {
  title: "Evaluation report — Eyewear RAG",
  description: "Golden-set results, judge validation, and the failures the harness actually caught.",
};

export default function EvalsPage() {
  const summary = loadEvalSummary();
  const goldenCounts = loadGoldenCaseCounts();
  const caseMatrix = loadCaseMatrix();

  return <EvalsPageClient summary={summary} goldenCounts={goldenCounts} caseMatrix={caseMatrix} />;
}
