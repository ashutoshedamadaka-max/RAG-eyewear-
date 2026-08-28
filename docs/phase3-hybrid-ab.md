# Phase 3 — hybrid A/B: catalog SQL vs. naive vector retrieval

Real evidence, captured 2026-08-28, from `npm run eval -- --pipeline=both`
(`evals/harness/reports/both-2026-08-28T09-45-52-089Z.json`). Same five
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
means.

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
| Polarized sports ≤₹2,500 (gap #1) | 0/1 | 0/3 |
| Progressive-ready rimless (gap #2) | 0/3 | 0/2 |
| Titanium ≤₹4,500 (gap #3) | 0/2 | 0/2 |
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
that nothing does. That's what the check below is for.

## Result 3: relaxation-ladder accuracy against independently-verified ground truth

`evals/golden/refusal.json`'s `nearest_miss` fields (decisions.md
2026-08-28, "golden set ground truth was circular") are generated directly
from the catalog by relaxing one constraint at a time — the exact same
algorithm `app/lib/catalog-db.ts#findNearestAlternatives` runs live, applied
independently. That makes them a real check, not a rubric written to match
what the pipeline happens to do.

| Query | Relaxed | Golden ground truth | Hybrid's live answer | Match? | Naive's substitution | Match? |
|---|---|---|---|---|---|---|
| gap #1 | price | Terra Optics Line 509, ₹3,500 | Terra Optics Line 509, ₹3,500 | ✅ | *(not offered)* | — |
| gap #1 | polarized | Wren Edition 729, ₹2,150 | Wren Edition 729, ₹2,150 | ✅ | *(not offered)* | — |
| gap #1 | sports tag | Kestrel Edition 850, ₹1,350 | Kestrel Edition 850, ₹1,350 | ✅ | Kestrel Edition 850, ₹1,350 (labeled "sports" — **false**) | ⚠️ right frame, wrong label |
| gap #2 | progressive_ready | Orbit&Co Line 482, ₹3,250 | Orbit&Co Line 482, ₹3,250 | ✅ | *(not offered)* | — |
| gap #2 | rim_type | Halcyon Type 165, ₹1,150 | Halcyon Type 165, ₹1,150 | ✅ | Corvin Mark 496, ₹4,250 (rimless, not progressive-ready) | ❌ wrong frame |
| gap #3 | material | Halcyon Type 165, ₹1,150 | Halcyon Type 165, ₹1,150 | ✅ | *(not offered)* | — |
| gap #3 | price | **Nira Edition 292, ₹4,600** | **Nira Edition 292, ₹4,600** | ✅ | Basalt Form 448, ₹4,800 (₹300 over — wrong; true gap is ₹100) | ❌ wrong frame |
| sports ≤₹500 | price | Wren Edition 729, ₹2,150 | Wren Edition 729, ₹2,150 | ✅ | Sable Series 805, ₹5,800 (labeled "sports/outdoor" — **false**) | ❌ wrong frame, wrong label |

**8 of 8 hybrid relaxations match verified ground truth exactly.** Zero of
naive's substitutions match a verified-correct nearest-miss frame; the one
case where it happened to name the same frame as the correct answer
(Kestrel Edition 850 for gap #1) still mislabeled it as sports-suitable,
which is the frame's actual disqualifying attribute. This is the concrete
version of the abstract claim in `PROJECT_CONTEXT.md` §1: cosine similarity
has no mechanism to compute "the cheapest frame that would qualify if I
dropped exactly this one requirement." SQL does, because that's what a
`WHERE` clause with one fewer condition literally is.

## Result 4: the `outdoor` ↔ `sports` defect class doesn't reproduce

`docs/phase1-baseline-failures.md` named a defect class: both chat models
tested there relabel `purpose_tags: ["driving_day", "outdoor"]` frames as
"sports" when convenient. It reproduces again in this run's naive column
— **twice**:

> gap #1: "**[3] Kestrel Edition 850**... suitable for outdoor use and
> **sports**." (Kestrel's tags are `["driving_day", "outdoor"]` — no
> `sports` tag.)

> sports ≤₹500: "**[4] Sable Series 805** — **sports**/outdoor sunglasses,
> polarized..." (Sable Series 805's tags are `["driving_day", "outdoor"]`
> — same defect, same frame class, different query.)

Hybrid's equivalent answers, generated by the same chat model at the same
temperature, get both right:

> gap #1: "**[3] Kestrel Edition 850** — Polarized and within budget at
> ₹1,350, but **is not listed for sports use**."

> sports ≤₹500: "**[1] Wren Edition 729** — ... It is otherwise designed
> for outdoor activities and **sports**..." (Wren Edition 729 genuinely has
> a `sports` tag — verified via the SQL join, not asserted.)

This isn't the chat model getting smarter — it's the same model. The
difference is that `frame_purpose_tags` membership is checked by a real SQL
`EXISTS` before the frame is ever shown to the model as a candidate, so
"does this include sports" stops being a claim the model has to get right
in prose and becomes a fact the query already enforced. `decisions.md`
2026-08-28 already noted this defect "is trivially fixed by SQL and unfixed
by any model upgrade" as a prediction; this is that prediction tested.

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
