import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Eyewear RAG — How It Works",
  description: "Why the catalogue is never embedded, the six-stage pipeline, and the split between structured filters and retrieval.",
};

export default function HowItWorksLayout({ children }: { children: React.ReactNode }) {
  return children;
}
