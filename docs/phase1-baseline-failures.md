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
