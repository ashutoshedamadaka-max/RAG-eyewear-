# Phase 4 — the advice/RAG half, built and evaluated

Real evidence, captured 2026-08-31. This is the half of `PROJECT_CONTEXT.md`
§1's architecture that was never built until now: catalog → SQL (Phase 3)
stays exactly as it was; advice → RAG with citations is new
(`app/lib/advice-retrieval.ts`, `app/lib/pipelines/orchestrated.ts`); one
agent orchestrates both in a single answer.

## What's new, precisely

- **Chunking, documents only.** `app/scripts/build-advice-chunks.ts` splits
  `data/advice/*.md` into one chunk per H2 section — never the catalog,
  which stays in SQLite behind `WHERE` (chunking it would rebuild the naive
  baseline Phase 1 was built to disprove). 19 chunks from 6 documents.
  Tables verified intact (a table split across two chunks is useless); a
  real authoring gap caught mid-build — one document had prose between its
  H1 and first H2 that the chunker would have silently dropped — was fixed
  in the source document, not papered over in the chunker.
- **`claim_type` doing three jobs, not one.** Register (physical stated
  plainly, convention hedged), authority (physical may drive hard SQL
  constraints, convention only nudges ranking — generalizing the existing
  face-shape rule into policy), exclusion (`opinion` filtered at ingest,
  and the filter actually runs — see decisions.md 2026-08-31 for why this
  matters more than it sounds).
- **One orchestrated pipeline**, registered alongside `naive` and `hybrid`
  in `app/lib/pipelines/index.ts` so `npm run eval -- --pipeline=both` now
  runs all three. Frame selection is byte-identical to `hybrid.ts`; new is
  a second retrieval pass over advice chunks folded into the same
  generation call.
- **A system prompt built around one hazard**: warmth reads as confidence.
  Persona stated first, eight explicit constraints stated second — see
  `app/lib/pipelines/orchestrated.ts`.
- **Three LLM judges** (groundedness, citation accuracy, hedging-matches-
  claim-type) — the first judges in this project, used only because these
  three properties are properties of prose that
  `app/lib/constraints.ts`'s deterministic checks can't grade.

## Result 1: constraint compliance is unchanged, as it should be

| Query | naive | hybrid | orchestrated |
|---|---|---|---|
| Titanium ≤₹8,000, in stock | 3/3 | 3/3 | 5/5 |
| Polarized sports ≤₹2,500 | 0/1 | 0/3 | 0/3 |
| Progressive-ready rimless | 0/3 | 0/2 | 0/2 |
| Titanium ≤₹4,500 | 0/2 | 0/2 | 0/2 |
| Sports ≤₹500 | 0/2 | 0/1 | 0/1 |

Orchestrated and hybrid match on every query (`evals/harness/reports/both-2026-08-31T06-01-05-331Z.json`)
— expected and correct: adding the advice layer doesn't change *which*
frames SQL selects, only how the answer explains them. If these numbers
had diverged, that would mean the advice layer was somehow leaking into
frame selection, which the architecture explicitly forbids.

## Result 2: retrieval scores are honest about relevance — the pipeline just doesn't act on it

The five `physical.json` golden queries are catalog-filter queries
("titanium under ₹X, in stock") — none of them are actually "why"
questions the six-document advice corpus has anything to say about, and
four of five show it:

| Query | Top advice score | On-topic? |
|---|---|---|
| Titanium ≤₹8,000, in stock | 0.309 | No |
| Polarized sports ≤₹2,500 | 0.340 | No |
| **Progressive-ready rimless** | **0.600** | **Yes** |
| Titanium ≤₹4,500 | 0.306 | No |
| Sports ≤₹500 | 0.295 | No |

Compare against real "why" questions run during judge-validation
construction (`decisions.md` 2026-08-31): "will rimless work for a strong
prescription" scored 0.559 top; "small face, will progressives fit"
scored 0.545 top. There's a real, honest ~0.20 gap between on-topic and
off-topic retrieval — the embedding model isn't confused about relevance.

**The finding is not "recall looks fake-great."** It's narrower and more
useful: `retrieveAdviceTopK` (`app/lib/advice-retrieval.ts`) always returns
exactly `k` results with no relevance floor, so a query the corpus has
nothing to say about still gets four chunks in the ~0.26-0.34 range
presented to the generation step as "Retrieved advice" — same framing as a
genuinely relevant 0.55 hit. For "Titanium frames under 8000 rupees, in
stock," the model was handed two Vision Council fitting-height entries and
two TTUHSC rimless-material entries, none remotely relevant, and had to
notice that itself and not cite them (which, in every transcript checked,
it correctly did not). That's the generation step's discipline compensating
for a retrieval-layer gap, not evidence the retrieval layer is fine. A
score-floor cutoff (below which the advice section is simply omitted
rather than populated with the least-bad top-k) is a real, not-yet-built
improvement this evidence points to directly.

Six documents is also just a genuinely narrow corpus — 4 of 6 documents
are about progressive fitting heights specifically (a consequence of
Phase 3's threshold research driving what got sourced, decisions.md
2026-08-29) and one is about rimless materials; there is no document about
UV protection, sports eyewear, face-width fitting, or most of the topics
`PROJECT_CONTEXT.md` §5 actually lists as needed. A recall number computed
against this corpus, on any query set, would currently be measuring "does
retrieval find the closest thing in a narrow, lopsided six-document
corpus," not "does retrieval find the right answer" — worth stating
plainly rather than reporting a number that implies more coverage than
exists.

## Result 3: the judge validation process caught more real bugs than it validated the judges

`evals/golden/judge_validation.json` — 15 hand-labelled examples (6 real
pipeline transcripts, hand-verified claim-by-claim against
`data/catalog/out/catalog.json` before labelling; 9 constructed
adversarial examples covering failure modes real transcripts didn't
happen to exhibit). Final agreement after two rounds of prompt refinement:
groundedness 93% (14/15), citation accuracy 85% (11/13), hedging match
100% (3/3) — see decisions.md 2026-08-31 for the full iteration, including
two judge-prompt corrections (decorrelating groundedness from citation
correctness, which were unintentionally overlapping; carving out brief
definitional elaboration of jargon from both, since the system is
separately required to explain technical terms) and four label corrections
to *my own* hand-labelling, not the judges':

- **The standout catch**: a real transcript answering "progressive lenses,
  small face, will they fit" compared a frame's `lens_height_mm` (a
  B-height/frame-depth figure) directly against a 16-20mm *fitting-height*
  range from retrieved advice — conflating the exact two measurements
  Phase 3's own threshold re-provenance work (decisions.md 2026-08-29) was
  built to keep distinct, in a context where the retrieved advice
  explicitly warned against that exact conflation. My first-pass hand
  label said this transcript passed groundedness. It didn't, and the judge
  was right before I was. **Fixed at the source**: `orchestrated.ts`'s
  system prompt now states the distinction explicitly (constraint 9);
  re-running the identical query confirms the fix — the new answer
  correctly separates "lens height" from "fitting height" and says the
  optician still needs to measure the latter.
- A real transcript conflated the customer's stated ₹3,000 *budget* with a
  specific frame's price in one confusing sentence — missed on first
  pass, caught by the judge, hand label corrected.
- A real transcript speculated that "tapered temples" aid fit adjustment
  and compared a frame's weight against the customer's unstated current
  frame — both ungrounded, both missed on first pass.
- My own constructed "correctly hedged" positive-control example
  referenced something ("you also mentioned progressives") the query
  never said — an authoring bug in the test, not the system, caught by
  the same judge run and fixed in the test.

Reported honestly rather than re-running until every disagreement
vanished: two disagreements remain in the final run, both defensible
alternate readings of ambiguous prose (a superlative claim about which
frame is "nearest by size" that holds in one dimension and not another; a
terminology question about whether 1.67 counts as "very-high-index").
`gpt-5.6-luna` also does not support `temperature=0`, so judge verdicts
are not perfectly reproducible run-to-run — a second real reason to
re-validate periodically (`npm run validate-judges`), not treat this as a
one-time gate.

## Reproduce

```bash
cd app
npm run advice-chunks && npm run embed-advice   # -> ../data/advice/out/
npm run validate-judges                          # judges vs. hand labels
npm run eval -- --pipeline=both                  # naive vs hybrid vs orchestrated
```
