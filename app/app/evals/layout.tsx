import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Eyewear RAG — Evaluation Report",
  description: "Full evaluation report: judge methodology, validation against hand-labelled cases, the three golden sets, and what the evals caught.",
};

export default function EvalsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
