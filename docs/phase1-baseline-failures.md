# Phase 1 baseline failures — evidence log

Real request/response pairs against the naive pure-vector baseline
(`app/app/api/query/route.ts`), captured 2026-08-27. Not narrated, not
constructed after the fact — these are the actual API responses from a
running server, verified against `data/catalog/out/catalog.json`.

**Pipeline**: OpenAI `text-embedding-3-small` over one flattened prose blurb
per frame (`data/catalog/out/blurbs.json`), brute-force cosine similarity,
top-5, stuffed into a `gpt-4o-mini` prompt. No SQL filtering, no metadata
pre-filtering, no reranking.

Three of the five queries deliberately target the catalog's intentional
gaps (§4 of `PROJECT_CONTEXT.md`), which `validate.py` asserts stay empty:
no polarized sports sunglasses under ₹2,500, no progressive-ready rimless
frames, no titanium under ₹4,500. Correct behavior on those three is an
honest "nothing qualifies" — none of them got it.

---

## 1. "Titanium frames under 8000 rupees, in stock" — passed

Recommended Basalt Form 448 (₹4,800) and Sable Edition 852 (₹6,850), both
titanium, both in stock, both under budget. The retrieved set also
correctly excluded Vayu Type 958 (out of stock) and Truss Mark 538
(₹9,650, over budget) from the final picks.

**Included as a control.** Vector similarity isn't uniformly broken — when
enough valid candidates happen to also be semantically similar to the
query text, the naive baseline can land on a correct answer. The failures
below aren't "the model is bad," they're "similarity has no mechanism to
enforce the constraint," which only shows up once a query's valid answer
set is small or empty.

## 2. "Polarized sports sunglasses under 2500 rupees" — failed (intentional gap #1)

> "**Kestrel Edition 850 (SKU KES-040)** - Priced at INR 1350... suitable
> for outdoor activities. It features UV400 protection and polarized amber
> tint lenses... The Kestrel Edition is a great choice for **sports** and
> outdoor use within your budget."

Ground truth: Kestrel Edition 850's `purpose_tags` are
`['driving_day', 'outdoor']` — **not `sports`**. The catalog's actual
sports-tagged, polarized frame in the retrieved set, Corvin Edition 683,
is both out of stock and ₹7,900 (over budget), and the model never
mentions it exists or that it's excluded. Instead it silently relabels a
non-sports frame as "a great choice for sports" to make the answer look
complete.

This is the sharpest failure of the five: not a visible contradiction, but
a quiet misrepresentation of a field that isn't in question — the kind of
error an eval harness has to catch because a reader skimming the answer
wouldn't.

## 3. "Progressive-ready rimless frames" — failed (intentional gap #2)

> "**Orbit&Co Series 396 (SKU ORB-015)**: ... is progressive-ready and
> suitable for narrow face widths... the Orbit&Co Series 396 **fits your
> request perfectly**."

Ground truth: Orbit&Co Series 396's `rim_type` is `semi` — not rimless.
Zero frames in the top-5 retrieved set are both rimless and
progressive-ready (the one rimless hit, Corvin Mark 496, has
`progressive_ready: false` and wasn't recommended). The model picked the
closest available compromise and asserted it was a perfect match on the
exact dimension it fails.

## 4. "Titanium frames under 4500 rupees" — failed (intentional gap #3)

> "**Basalt Form 448 (SKU BAS-092)** - Priced at INR 4800... Unfortunately,
> **the other frames listed exceed your budget.**"

Self-contradictory in one breath: the recommended frame is itself ₹300
over the stated ₹4,500 ceiling, and the sentence right after the
recommendation implies everything *except* the pick is over budget. Cosine
similarity put a near-miss item at the top of the ranking and the model
narrated around the mismatch rather than surfacing it.

## 5. "Sports sunglasses under 500 rupees" — correct refusal

> "It seems there are no suitable options available in the retrieved
> frames, as all of them exceed the budget... I can't recommend a frame
> that meets your criteria for both budget and purpose."

Not one of the three intentional gaps — just an extreme, obviously-empty
request (cheapest frame in the catalog is nowhere near ₹500). Included
because it shows the baseline *can* refuse when the mismatch is large
enough to be unambiguous in the retrieved text. The failures above are the
dangerous case: near-miss items that read as plausible enough for the
model to paper over the gap instead of naming it.

---

## What this demonstrates

The naive baseline doesn't fail by being obviously wrong — it fails by
being *confidently, specifically wrong* on close calls, three-for-three on
the catalog's known-empty constraint combinations. It has no mechanism to
represent "nothing satisfies this" short of the request being wildly
out of range, because cosine similarity always returns *something*
similar; there's no constraint to violate, only a ranking. This is the
opening-scene evidence for the hybrid split argued in
`PROJECT_CONTEXT.md` §1 and `decisions.md`: numeric/categorical
constraints belong in SQL, not in embedding space.

---

## Re-run on gpt-5.6-luna (2026-08-28) — does the failure persist on a current model?

The obvious objection to everything above: "you used a weak, aging model —
of course it failed." Re-ran the same five queries on a current model to
test that directly. See `decisions.md` 2026-08-28 for the model-selection
reasoning (gpt-4o-mini → gpt-5.6-luna, not `-terra`, which is the mid tier
not the small one; pinned to the rolling alias because OpenAI hasn't
published a dated snapshot for this family yet).

**Pipeline parameters** (see Appendix for the full verbatim system prompt):

| | |
|---|---|
| Embedding model | `text-embedding-3-small` (unchanged) |
| Chat model | `gpt-5.6-luna` (rolling alias — no dated snapshot published as of 2026-08-28) |
| Temperature | `1` (now explicit; was an implicit default in the gpt-4o-mini run) |
| Top-k | `5` |
| Run via | `npm run eval -- --pipeline=naive` (`app/scripts/run-eval.ts`) |
| Full report | `evals/harness/reports/naive-2026-08-28T07-52-10-567Z.json` |

**Retrieval scores are byte-identical to the original run** — same
embedding model, same catalog, same query text, so cosine similarity
produces the same ranking regardless of which chat model reads the result.
Only the generation step changed between the two runs. That's worth stating
plainly: the retrieval failure and the generation failure are separable,
and only generation is what the model swap could possibly have fixed.

Pass rates below are from the constraint-violation harness
(`app/lib/constraints.ts`) — direct field comparisons against
`data/catalog/out/catalog.json`, no LLM judge. "Retrieved" checks all 5
top-k hits; "recommended" checks only the frames the model actually
surfaced in its answer.

### 1. "Titanium frames under 8000 rupees, in stock" — passed (retrieved 3/5, recommended 3/3)

| Rank | Frame | Score | Violations |
|---|---|---|---|
| 1 | Vayu Type 958 (VAY-035) | 0.5371 | price ₹8,250 > 8,000; out of stock |
| 2 | Truss Mark 538 (TRU-023) | 0.5294 | price ₹9,650 > 8,000 |
| 3 | Basalt Form 448 (BAS-092) | 0.5272 | — |
| 4 | Terra Optics Mark 282 (TER-078) | 0.5232 | — |
| 5 | Sable Edition 852 (SAB-082) | 0.5174 | — |

> "**[3] Basalt Form 448** — INR 4,800, in stock... **[4] Terra Optics Mark
> 282** — INR 6,000, in stock... **[5] Sable Edition 852** — INR 6,850, in
> stock."

Recommended exactly the three passing hits, correctly skipped the
out-of-stock and over-budget ones. Same result as gpt-4o-mini. Note the
model didn't cite SKUs verbatim this time (gpt-4o-mini consistently wrote
"(SKU XXX-000)"; gpt-5.6-luna used only the bracketed retrieval index) —
the harness's SKU-regex extraction fell back to `[n]` bracket-index mapping
to handle this, which is why that fallback exists.

### 2. "Polarized sports sunglasses under 2500 rupees" — failed (retrieved 0/5, recommended 0/1)

| Rank | Frame | Score | Violations |
|---|---|---|---|
| 1 | Corvin Edition 683 (COR-005) | 0.5236 | price ₹7,900 > 2,500 |
| 2 | Sable Series 805 (SAB-063) | 0.5156 | price ₹5,800 > 2,500; not `sports`-tagged |
| 3 | Kestrel Edition 850 (KES-040) | 0.5103 | not `sports`-tagged |
| 4 | Aeris Line 462 (AER-089) | 0.5026 | price ₹3,800 > 2,500; not polarized |
| 5 | Sundial Type 312 (SUN-012) | 0.5000 | not `sports`-tagged; not polarized |

> "Only one retrieved frame meets all your requirements—**polarized,
> suitable for sports, and under ₹2,500**: **[3] Kestrel Edition 850** —
> ₹1,350... Suitable for outdoor use and sports."

Identical failure to gpt-4o-mini's run: Kestrel Edition 850's actual
`purpose_tags` are `["driving_day", "outdoor"]`, not `sports`. This time the
model states its criteria explicitly ("polarized, suitable for sports, and
under ₹2,500") and then recommends a frame that fails one of the three
criteria it just named — an even sharper self-contradiction than the
original run's version of this failure.

### 3. "Progressive-ready rimless frames" — failed (retrieved 0/5, recommended 0/3)

| Rank | Frame | Score | Violations |
|---|---|---|---|
| 1 | Basalt Line 176 (BAS-077) | 0.5266 | not progressive-ready; rim_type=full |
| 2 | Fathom Edition 531 (FAT-041) | 0.5152 | not progressive-ready; rim_type=full |
| 3 | Fathom Series 616 (FAT-036) | 0.5097 | rim_type=full |
| 4 | Corvin Mark 496 (COR-081) | 0.5077 | not progressive-ready |
| 5 | Orbit&Co Series 396 (ORB-015) | 0.5074 | rim_type=semi |

> "No frame fully matches **both progressive-ready and rimless**. The
> closest options are: **[5] Orbit&Co Series 396** — Progressive-ready...
> semi-rim... **[3] Fathom Series 616** — Progressive-ready... full rim and
> currently out of stock. The only fully rimless option, **[4]**, is not
> progressive-ready."

Genuinely better than the gpt-4o-mini run in one respect: this answer
explicitly states no frame matches both criteria, names which constraint
each pick fails, and even flags that Fathom Series 616 is out of stock (a
detail the old run's answer omitted entirely). It still recommends 3 frames
that all fail the hard constraint — the harness correctly scores this 0/3 —
but the *honesty* of the framing is closer to the relaxation-ladder ideal
than the old run's "fits your request perfectly" language. Framing quality
and constraint compliance are different axes; see `decisions.md`.

### 4. "Titanium frames under 4500 rupees" — failed (retrieved 0/5, recommended 0/2)

| Rank | Frame | Score | Violations |
|---|---|---|---|
| 1 | Vayu Series 357 (VAY-047) | 0.5397 | price ₹6,150 > 4,500 |
| 2 | Basalt Form 448 (BAS-092) | 0.5391 | price ₹4,800 > 4,500 |
| 3 | Sundial Series 103 (SUN-019) | 0.5377 | price ₹5,400 > 4,500 |
| 4 | Truss Mark 538 (TRU-023) | 0.5341 | price ₹9,650 > 4,500 |
| 5 | Terra Optics Mark 282 (TER-078) | 0.5324 | price ₹6,000 > 4,500 |

> "No retrieved frames meet the requirement of **titanium and under
> ₹4,500**. Closest options if you can stretch the budget: **[2] Basalt
> Form 448** — Titanium, ₹4,800... **[3] Sundial Series 103** — Titanium,
> ₹5,400..."

Better framing than the old run (explicitly says nothing meets the
requirement, offers two labeled "stretch" options instead of asserting a
false match) — but this time it recommends *two* over-budget frames instead
of one, and neither recommendation names the actual overage amount (₹300
for Basalt, ₹900 for Sundial). The relaxation-ladder ideal is specific:
"₹300 over your ceiling" is more useful than "if you can stretch the
budget." See the natural experiment below — Basalt Form 448 is the thread
connecting this query to query #1.

### 5. "sports sunglasses under 500 rupees" — failed (retrieved 0/5, recommended 0/2)

| Rank | Frame | Score | Violations |
|---|---|---|---|
| 1 | Sundial Type 312 (SUN-012) | 0.5239 | price ₹1,250 > 500; not `sports`-tagged |
| 2 | Corvin Edition 683 (COR-005) | 0.5170 | price ₹7,900 > 500 |
| 3 | Sundial Form 288 (SUN-056) | 0.5129 | price ₹4,900 > 500; not `sports`-tagged |
| 4 | Sable Series 805 (SAB-063) | 0.5045 | price ₹5,800 > 500; not `sports`-tagged |
| 5 | Sundial Mark 819 (SUN-072) | 0.5026 | price ₹3,500 > 500; not `sports`-tagged |

> "No frames meet the **under ₹500** budget. The closest sports-suitable
> options are: **[4] Sable Series 805** — ₹5,800... **[2] Corvin Edition
> 683** — ₹7,900... Both are far above the ₹500 budget."

**This is the one query that got worse, and it's a genuinely mixed
result.** gpt-4o-mini refused outright here ("I can't recommend a frame
that meets your criteria"). gpt-5.6-luna instead does almost exactly what
the relaxation ladder asks for — names the violated budget constraint,
offers the two nearest alternatives, states plainly that both are over
budget — except it calls both alternatives "sports-suitable" when neither
is `sports`-tagged (Sable Series 805 is `["driving_day", "outdoor"]`,
same mislabeling as query #2). So: better on the price-transparency axis,
identically wrong on the purpose-tag axis. A cheaper, newer model isn't
uniformly more cautious — it's differently wrong, and a harness that only
checked "did it refuse" would have missed the persisting purpose-tag defect
entirely, while a harness that only checked hard constraints would have
missed the framing improvement. Both matter; they're graded separately for
a reason (`PROJECT_CONTEXT.md` §6).

---

## Natural experiment: Basalt Form 448 across two budget ceilings

Queries #1 and #4 both surface the same frame, Basalt Form 448 (₹4,800,
titanium, rimless), from the same catalog, same embeddings, same chat
model. The only thing that changed between the two queries is the number
in the budget clause — ₹8,000 in #1, ₹4,500 in #4 — which flips the frame
from valid to invalid.

| Query | Budget ceiling | Basalt Form 448's cosine score | Rank in top-5 | Actually valid? | Recommended? |
|---|---|---|---|---|---|
| #1 | ₹8,000 | 0.52725 | 3rd | Yes (₹4,800 ≤ ₹8,000) | Yes |
| #4 | ₹4,500 | 0.53908 | 2nd | **No** (₹4,800 > ₹4,500) | Yes |

The score barely moves (0.527 → 0.539, a 0.012 shift — smaller than the gap
between adjacent ranks in either list) even though the budget number in the
query text changed by ₹3,500 and the frame's actual validity flipped
entirely. That's the mechanistic proof, not just the qualitative pattern:
cosine similarity is responding to "titanium... frame..." matching the
blurb text, and is essentially blind to which number follows "under ₹."
The embedding has no representation of "4,800 > 4,500" — it can't, a
sentence embedding doesn't parse arithmetic — so the ranking is nearly
identical for two queries with opposite correct answers.

---

## Appendix: verbatim system prompt

```
You are an eyewear store assistant. Recommend 2-3 frames from the retrieved
product descriptions below that best match the customer's request. Only use
frames from the retrieved list; do not invent frames. Reference each pick by
its bracketed number.
```

User message template: `Customer request: {query}\n\nRetrieved frames:\n{context}`,
where `{context}` is the top-5 blurbs joined as `[1] {text}\n\n[2] {text}...`.
Source: `app/lib/pipelines/naive.ts`, shared by both the API route and the
eval harness so every run — this doc's, the harness's, and any future
one — exercises the identical code path.
