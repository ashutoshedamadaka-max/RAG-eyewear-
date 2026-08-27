# Decision log

Append-only. Log reversals and dead ends too — a log with no failures in it
reads as reconstructed after the fact, because it usually is.

Format: date · decision · why · what was rejected

---

## 2026-08-27 · Domain: eyewear recommender
Chosen for demo appeal and because the catalog has real weekly churn (new
arrivals, price drops, stock-outs), which makes the knowledge-base freshness
story real rather than narrated.
Rejected: board-game rules assistant (cleaner ground truth, less commercial),
library version-migration assistant (great version-aware retrieval story, less fun).
Known risk: style claims are convention, not evidence — handled by hedging
policy and claim_type tagging.

## 2026-08-27 · Architecture: hybrid, not pure RAG
Catalog goes to SQL/structured filters; optician advice goes to RAG with
citations; one agent orchestrates both.
Vector search cannot satisfy numeric constraints ("under ₹8,000, titanium,
fits 62mm PD, in stock"). Embedding product blurbs is the standard failure of
AI recommender demos.
TO PROVE: Phase 1 builds the naive pure-vector version deliberately and measures
it failing, so the Phase 3 A/B has a real baseline.

## 2026-08-27 · Catalog: synthetic, documented
100 frames from realistic distributions rather than scraped listings.
Gives control over edge cases and over Phase 5 churn; removes the licensing
question. Advice corpus will NOT be synthetic — see PROJECT_CONTEXT §5.

## 2026-08-27 · Images: parametric SVG, not photos
Rendered from each row's own attributes, so an image cannot contradict its spec.
Rejected: real product photos (licensing + spec/photo mismatch), AI-generated
photos (inconsistent, still mismatched, IP risk).

## 2026-08-27 · Face shape is a soft signal, never a filter
It is the weakest claim in the knowledge base. Used as a ranking nudge (+0.15
max) and to justify picks, never to exclude frames.

## 2026-08-27 · Out of scope
No auth, no checkout, no photo-based face-shape detection. The last is a
computer-vision problem that would consume a third of the timeline and add
nothing to the retrieval story.

---
<!-- next entry here -->
