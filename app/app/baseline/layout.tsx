import type { Metadata } from "next";

// baseline/page.tsx is a client component and can't export `metadata`
// itself -- this overrides the root layout's title (now "A Fitting
// Conversation") so the browser tab makes the distinction too, not just
// the in-page banner.
export const metadata: Metadata = {
  title: "Eyewear RAG — Phase 1 Naive Baseline (comparison only)",
  description: "Pure vector RAG over the eyewear catalog, deliberately naive -- the failure case the real system is measured against.",
};

export default function BaselineLayout({ children }: { children: React.ReactNode }) {
  return children;
}
