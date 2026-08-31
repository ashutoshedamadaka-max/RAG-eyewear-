# Phase 3 — hybrid A/B: catalog SQL vs. naive vector retrieval

Real evidence, captured 2026-08-28, from `npm run eval -- --pipeline=both`
(`evals/harness/reports/both-2026-08-28T10-25-16-718Z.json`, after the
ordered-categorical-relaxation fix below — see decisions.md for the earlier
run this superseded). Same five
golden query cases (`evals/golden/physical.json`), same chat model and
temperature (`app/lib/config/model.ts` — both pipelines import from the
same file specifically so the A/B isolates the retrieval mechanism as the
only variable), same harness, same constraint checks. Only the retrieval
step differs.

## What "hybrid" means here, precisely

Per `PROJECT_CONTEXT.md` §1, the target architecture is catalog → SQL,
advice → RAG with citations, one agent orchestrating both. **This is the
catalog → SQL half only.** `data/advice/` is still empty — no real advice
corpus has been sourced yet, and `decisions.md` already commits to not
fabricating one with an LLM — so there is nothing to run RAG over. The
`hybrid` pipeline built here is catalog-only; it does not produce advice
citations. That's a documented gap, not a silent one: `app/lib/pipelines/hybrid.ts`
says so in its header comment, and this doc says so here.

It's also a single-turn pipeline (one query in, one answer out), matching
the naive baseline's shape for a fair comparison — not the full multi-turn
conversational slot-filling layer described in `PROJECT_CONTEXT.md` §3
(STATED → DERIVED → QUERY, rx_power-driven derivation rules, the five-question
cap, etc.). That's a larger feature for later; this is the minimum needed
to prove the SQL-vs-vector claim the whole project's architecture argument
rests on.

**Mechanism:**

1. **Extract** — the chat model, given the query, calls a function-calling
   tool (`extract_filter`) to produce a structured filter (product type,
   material, price bounds, purpose tags, polarized/UV400/progressive-ready/
   rim-type requirements). `reasoning_effort: "none"` is set on this call
   only — `gpt-5.6-luna` rejects function tools on `/v1/chat/completions`
   otherwise (confirmed against the live API 2026-08-28); the generation
   call is untouched so the naive pipeline's already-established behavior
   isn't retroactively affected by an unrelated fix.
2. **Query** — the filter compiles to real parameterized SQL against
   `data/catalog/out/catalog.db` (SQLite, built by
   `app/scripts/build-catalog-db.ts` using `node:sqlite`, built into
   Node 22+ — no extra dependency, same scale judgment as the naive
   pipeline's in-memory vector store). Purpose tags join against a
   `frame_purpose_tags(frame_id, tag)` table, so tag membership is a real
   `EXISTS` check against the catalog, not a text match.
3. **Relax, if empty** — `app/lib/catalog-db.ts#findNearestAlternatives`
   drops exactly one clause at a time (all purpose-tag clauses relax
   together, as one requirement), re-runs the query, and returns the
   cheapest frame that qualifies once that one requirement is dropped —
   the relaxation ladder from `PROJECT_CONTEXT.md` §3, operationalized.
   For `rim_type` and `material`, "drop the clause" doesn't mean "any
   value" — it walks an ordered domain
   (`app/lib/config/domains.ts`: `rimless → semi → full`,
   `titanium → metal → {tr90, acetate}`) one tier at a time, so a rimless
   request resolves to semi-rim before full-rim, and a titanium request
   resolves to metal before plastic. See "Result 3" below for what this
   changed.
4. **Generate** — same bracketed-reference prose convention as the naive
   pipeline. If alternatives were used instead of exact matches, each is
   labeled with exactly which requirement it drops, and the system prompt
   instructs the model never to claim an alternative satisfies a
   requirement its label says it drops.

## Result 1: retrieval quality on the control query

| | naive (retrieved top-5 pass rate) | hybrid (retrieved pass rate) |
|---|---|---|
| Titanium ≤₹8,000, in stock | 3/5 | 5/5 |

Naive's top-5 for this query includes Vayu Type 958 (₹8,250, over budget)
and Truss Mark 538 (₹9,650, over budget) — both semantically close enough
to rank in the top 5 by cosine similarity despite failing the stated price
ceiling. SQL doesn't have a "close enough" mode for a numeric comparison;
every one of hybrid's 5 results satisfies all three constraints, because
that's what `WHERE material = ? AND price_frame_only <= ? AND in_stock = 1`
means. Hybrid's recommended-frame pass rate is 5/5 too — this run's
generation step named all five, all valid.

**Sharper than the pass-rate number:** hybrid's answer for this query names
**Nira Edition 292 at ₹4,600** — the actual cheapest titanium frame in the
entire catalog. Naive has never surfaced this frame in any run logged in
this project (`docs/phase1-baseline-failures.md`, this doc's naive-column
answers below) — it doesn't rank in the top-5 by cosine similarity for any
of the titanium queries tested, on either chat model. The naive baseline's
"passing" answer to this control query was still missing the best available
option. SQL sorted by price found it immediately.

## Result 2: the recommended-frame pass rate is the wrong headline number for empty-gap queries, and here's why

| Query | naive recommended pass | hybrid recommended pass |
|---|---|---|
| Polarized sports ≤₹2,500 (gap #1) | 0/3 | 0/3 |
| Progressive-ready rimless (gap #2) | 0/3 | 0/2 |
| Titanium ≤₹4,500 (gap #3) | 0/1 | 0/2 |
| Sports ≤₹500 | 0/2 | 0/1 |

Read naively, hybrid looks the same or worse — more non-compliant frames
recommended per query. **This number is structurally 0/N for both
pipelines on every one of these queries, and has to be:** the catalog
genuinely contains zero frames satisfying the full constraint set (three
are intentional gaps `validate.py` asserts stay empty; the fourth is just
out of range). No pipeline can score above 0 here without inventing a
frame. The pass-rate check `app/lib/constraints.ts` runs is a floor-level
mechanistic check — "does the recommendation satisfy every stated
constraint" — and it isn't equipped to grade *how well* a system explains
that nothing does. That's what the check below is for. (One more reason
not to over-read this table: the frame-extraction regex counts any
bracketed reference in the answer, including a frame explicitly named as
*excluded* — "the other options, **[1]** and **[2]**, exceed your budget"
counts [1] and [2] toward the denominator even though the prose is
correctly declining them. Read the quotes, not just the fraction.)

## Result 3: relaxation-ladder consistency check, and comparison against naive's substitutions

**Framing correction (2026-08-28):** an earlier version of this section
called the match between `evals/golden/refusal.json`'s `nearest_miss`
fields and `app/lib/catalog-db.ts#findNearestAlternatives`'s live output
"independently-verified ground truth." That overstated it. Both are the
*same algorithm* — relax one constraint, walk the ordered domain if there
is one, take the cheapest frame that qualifies — implemented twice: once
as an in-memory JS filter over `catalog.json`
(`app/lib/nearest-miss.ts#computeNearestMisses`, used to generate the
golden set) and once as live parameterized SQL
(`app/lib/catalog-db.ts#findNearestAlternatives`, used by the pipeline).
Agreement between them is a **consistency check** — it shows the two code
paths aren't buggy relative to each other, and specifically that porting
the ordered-domain fix (below) to both places didn't introduce a drift
between them. It does **not** independently validate that "cheapest frame
after relaxing exactly one constraint" is the *right* notion of nearest
miss — that's a design choice, not an externally verified fact, and both
implementations share it. What the table below still legitimately shows is
narrower and still real: both are computed directly from the catalog, so
neither inherits the circularity bug (`decisions.md`, "golden set ground
truth was circular") that produced naive's wrong answers in the first
place.

**Also updated in this run:** relaxing `rim_type` or `material` no longer
jumps straight to "any value." It walks the ordered domain
(`app/lib/config/domains.ts`) one tier at a time. Two rows below changed as
a result: gap #2's rim_type relaxation now resolves to a semi-rim frame
(one step from rimless) instead of a full-rim frame (two steps), and gap
#3's material relaxation now resolves to a metal frame (one step from
titanium) instead of a plastic one (two steps) — both cheaper *and* closer
to the original request than before.

| Query | Relaxed | Golden generator (`nearest-miss.ts`) | Hybrid live (`catalog-db.ts`) | Consistent? | Naive's substitution |
|---|---|---|---|---|---|
| gap #1 | price | Terra Optics Line 509, ₹3,500 | Terra Optics Line 509, ₹3,500 | ✅ | *(not offered)* |
| gap #1 | polarized | Wren Edition 729, ₹2,150 | Wren Edition 729, ₹2,150 | ✅ | *(not offered)* |
| gap #1 | sports tag | Kestrel Edition 850, ₹1,350 | Kestrel Edition 850, ₹1,350 | ✅ | Kestrel Edition 850, ₹1,350, no sports claim made this run (see Result 4) |
| gap #2 | progressive_ready | Orbit&Co Line 482, ₹3,250 | Orbit&Co Line 482, ₹3,250 | ✅ | *(not offered)* |
| gap #2 | rim_type | **Kestrel Edition 850, ₹1,350 (semi — 1 tier from rimless)** | **Kestrel Edition 850, ₹1,350 (semi)** | ✅ | Orbit&Co Series 396, ₹1,550 (semi, right category — but also offered Fathom Series 616, ₹8,250, full-rim and out of stock, as an equally-weighted option) |
| gap #3 | material | **Truss Series 377, ₹1,300 (metal — 1 tier from titanium)** | **Truss Series 377, ₹1,300 (metal)** | ✅ | *(not offered)* |
| gap #3 | price | Nira Edition 292, ₹4,600 | Nira Edition 292, ₹4,600 | ✅ | Basalt Form 448, ₹4,800 (₹300 over — wrong; true gap is ₹100) |
| sports ≤₹500 | price | Wren Edition 729, ₹2,150 | Wren Edition 729, ₹2,150 | ✅ | Sable Series 805, ₹5,800 (called "sporty" — see Result 4) |

**8 of 8 rows consistent between the two implementations.** Separately,
zero of naive's substitutions match either implementation's cheapest
answer — not because naive is "wrong" in some contestable sense on
category (its gap #2 answer does include a semi-rim, progressive-ready
option, the right tier), but because cosine similarity has no mechanism to
*sort* within that tier for cheapest, or to know it's a tier at all rather
than just "a similar-sounding frame." Naive offered Orbit&Co Series 396
(₹1,550, correct category) and Fathom Series 616 (₹8,250, full-rim, out of
stock — two tiers away and the single worst frame on the list for this
purpose) with equal weight in the same answer, because nothing in its
retrieval ranked one closer than the other. SQL's ordered-domain walk finds
Kestrel Edition 850 (₹1,350) specifically *because* it's cheapest within
the nearest tier, not just similar-sounding text.

## Result 4: the `outdoor` ↔ `sports` defect class — mechanically consistent, prose-severity varies

`docs/phase1-baseline-failures.md` named a defect class: chat models
relabel `purpose_tags: ["driving_day", "outdoor"]` frames as suitable for
`sports` when convenient. The mechanical fact is exactly as consistent as
that finding predicted: **every naive run logged in this project has
recommended a non-`sports`-tagged frame for a `sports` query, without
exception**, confirmed by `app/lib/constraints.ts` against the catalog,
not by reading tone. This run is no different — gap #1 and the ₹500 query
both still put a `["driving_day","outdoor"]` frame forward as an answer to
"sports."

The *prose* is milder this run than earlier ones (temperature is 1 for
both pipelines — some run-to-run variance in phrasing is expected and
shouldn't be over-read):

> gap #1, naive: "**[3] Kestrel Edition 850** — INR 1,350, polarized with
> UV400 protection, suitable for outdoor use, and lightweight... Matte
> black oval design with a subtle sporty appearance." (No flat "this is a
> sports frame" claim this run — but it's still the answer offered to a
> query asking specifically for `sports`, and Kestrel has no `sports` tag.)

> sports ≤₹500, naive: "**[4] Sable Series 805** — ₹5,800; sporty TR90
> frame with polarized amber lenses..." (Same tags, `["driving_day",
> "outdoor"]` — "sporty" is doing the same substitution more quietly.)

Hybrid's equivalent answers, same model, same temperature, don't have this
ambiguity to begin with, because the frame shown to the model as a
candidate was already filtered by a real SQL tag check:

> gap #1, hybrid: "**[3] Kestrel Edition 850** — Polarized and costs
> INR 1,350, but **is not tagged for sports use**."

> sports ≤₹500, hybrid: "**[1] Wren Edition 729** — ₹2,150. Sports-style
> sunglasses suitable for outdoor activities, but they do not satisfy the
> price requirement..." (Wren Edition 729 genuinely has a `sports` tag —
> confirmed by the `frame_purpose_tags` join before the model ever saw it,
> not asserted in prose.)

This isn't the chat model getting smarter — it's the same model. The
difference is that "does this include sports" stops being a claim the
model has to get right in prose and becomes a fact the query already
enforced before the candidate list was assembled. `decisions.md` 2026-08-28
already noted this defect "is trivially fixed by SQL and unfixed by any
model upgrade" as a prediction; this run is consistent with that a second
time, on softer phrasing than before.

## What this doesn't prove yet

- No advice/RAG half — catalog-only, as stated above.
- No multi-turn conversation, no `rx_power`-driven derivation rules from
  `PROJECT_CONTEXT.md` §3 (progressive lens height, high-index rim type,
  the fit-issue corrections) — those live in `app/lib/derivation.ts` and
  `app/lib/config/thresholds.ts` but aren't wired into the extraction step
  yet. `extract_filter`'s schema only covers the fields the five golden
  queries exercise.
- The `product_type` field the model inferred for two queries ("sports
  **sunglasses**...") isn't encoded in `physical.json`'s or `refusal.json`'s
  constraint sets for those cases. It didn't change any result here (every
  frame in the relaxation table above happens to already be `sunglasses`),
  but it's a latent gap in the golden sets worth closing before relying on
  this table for anything beyond this specific check.
- Five queries is not the ~40-case physical golden set. This is real
  evidence of the mechanism working, not a statistically powered claim.

## Reproduce

```bash
cd app
npm run build-catalog-db   # -> ../data/catalog/out/catalog.db
npm run eval -- --pipeline=both
```
