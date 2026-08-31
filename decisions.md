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

## 2026-08-27 · Phase 1: naive pure-vector baseline built and run
Next.js/TypeScript app, OpenAI `text-embedding-3-small` + `gpt-4o-mini`.
Every catalog row flattened into one unoptimized prose blurb
(`data/catalog/out/blurbs.json`), embedded, stored as a flat JSON array
(`embeddings.json`) — no vector DB. Query time: embed the query,
brute-force cosine similarity over all 100 vectors, top-5, stuff into the
chat prompt. No SQL filtering, no metadata pre-filtering, no reranking.

Rejected a real vector database (Pinecone/pgvector/etc.) at this stage:
100 rows makes brute-force cosine trivial, and introducing infra the
naive baseline doesn't need would blur the point being demonstrated.

Catalog-only, not "everything" — the advice corpus (§5) isn't sourced
yet, so there's nothing else to embed. Revisit once the advice corpus
lands; it may be worth re-running this same naive baseline over advice
text too before Phase 3, since RAG should look better there.

Ran 5 queries against the live API (`docs/phase1-baseline-failures.md`
has the full transcripts). 3/3 queries targeting the catalog's
intentional gaps (§4) failed — not by refusing, but by confidently
recommending a near-miss item and narrating around the violated
constraint (relabeling a non-sports frame as sports-appropriate, calling
a semi-rim frame a "perfect" rimless match, recommending a frame ₹300
over its own stated budget ceiling in the same sentence that says
everything else is over budget). A generic "titanium under 8,000, in
stock" query passed, and an extreme out-of-range query ("sports
sunglasses under 500 rupees") correctly refused — confirming the failure
mode is specifically the near-miss case, which is also the hardest one
for a skimming reader (or a naive eval) to catch. This is the baseline
Phase 3's hybrid A/B gets measured against.

## 2026-08-28 · Model rotation: gpt-4o-mini → gpt-5.6-luna
Confirmed independently before switching: gpt-4o-mini's Feb 13 2026 retirement
is ChatGPT-only (OpenAI's own retirement post + Azure docs, which has a
separate March 31 2026 Azure Foundry date that doesn't apply here — this
project calls the direct OpenAI API). Rotating anyway, per instruction, ahead
of Phase 3 to avoid a deprecation landing mid-A/B.

**Correction to the brief:** Terra is not the small/cheap tier. Checked the
live model list (`GET /v1/models`) and OpenAI's docs directly rather than
assume: Sol ($4/$20 per Mtok, flagship) > Terra ($2/$12, "balances
intelligence and cost" — the *mid* tier) > Luna ($0.20/$1.20,
"cost-sensitive workloads"). Pinned to **gpt-5.6-luna**, which is what
"current small/cheap text model" actually maps to.

**Could not pin a dated snapshot as instructed.** Checked both the live
`/v1/models` list and OpenAI's deprecations page: as of 2026-08-28 the
gpt-5.6 family exposes only rolling aliases (`gpt-5.6-sol` /
`-terra` / `-luna`) — no `gpt-5.6-luna-YYYY-MM-DD` snapshot has been
published yet. Pinned to the rolling alias instead and flagged it in code
(`app/lib/pipelines/naive.ts`) as a known re-runnability gap: the model
behind this alias can change under us without a code change. Revisit once
OpenAI publishes a snapshot for this family. `text-embedding-3-small`
unchanged, still current.

Also fixed: temperature was previously unset (implicit API default, =1).
Now set explicitly (`CHAT_TEMPERATURE = 1` in the same file) so the model
swap is the only varied input between the gpt-4o-mini and gpt-5.6-luna runs
— otherwise an implicit-default change on OpenAI's side could confound the
comparison.

**Still open: the API key itself hasn't been rotated in this session** — no
new key was provided. Once you have one: replace `OPENAI_API_KEY` in
`app/.env.local` (gitignored, never commit it) and nothing else needs to
change — no code references the key value directly.

## 2026-08-28 · Phase 1 re-run on gpt-5.6-luna: failures persist
Full transcripts, retrieved top-5 with cosine scores, and the verbatim
system prompt are in `docs/phase1-baseline-failures.md` (new section). Ran
via the new harness (`npm run eval -- --pipeline=naive`), which also
produces machine-checked pass rates — see the harness entry below.

Headline: all three intentional-gap queries still fail (0/5 retrieved,
0/1–0/3 recommended pass rate), and the control query still passes (3/3) —
the objection "your baseline failed because the model was weak and aging"
doesn't survive the re-run. New finding: the extreme out-of-range query
("sports sunglasses under ₹500") *also* now fails the mechanical check
(0/2), where gpt-4o-mini had refused outright. Worth being precise about
what changed, though: the new model's answer explicitly says "No frames
meet the under ₹500 budget" and names the price gap on both alternatives it
offers — structurally closer to the relaxation-ladder ideal (see refusal
framing entry below) than gpt-4o-mini's bare "I can't recommend a frame."
It still mislabels both alternatives as "sports-suitable" when neither is
`sports`-tagged — the same purpose-tag substitution failure as query #2,
just relocated. The harness's binary pass/fail correctly flags this as
non-compliant (it doesn't grade refusal-framing quality, only hard-constraint
compliance of what's actually recommended) — framing quality is what the
style/refusal golden sets are for, not this harness.

## 2026-08-28 · Advice corpus: third `claim_type`, `opinion`, excluded at ingest
The practising-optician source material is ~40% advocacy — independent
opticians vs. volume retail, the "designer glasses illusion," online
retailers failing on value. It's real, useful content, but it's the
author's commercial interest, not a physical fact or even a hedgeable style
convention. If it reached the corpus, the recommender would start telling
users designer frames are a con and they should visit an independent
optician — an opinion laundered through the assistant's voice as if it were
retrieved fact.

**Decision: exclude `opinion` at ingest, not at retrieval.** A retrieval-time
filter is one prompt change away from silently letting it back in, and
"filtered at generation" still means the embedding index contains it.
Excluding ~40% of the best single source we have is deliberate, not
oversight — logged here so it reads that way later. `claim_type` is now
`physical | convention | opinion` (PROJECT_CONTEXT.md §3, §5).

## 2026-08-28 · Contested thresholds: provisional midpoints, not expert-validated
Two values in `app/lib/config/thresholds.ts`, both **assumed, not
expert-validated** — pending confirmation from the optician, not resolved
clinical numbers:

- **`PROGRESSIVE_MIN_LENS_HEIGHT_MM = 32`** (was 30; optician says >44mm for
  25mm-zone varifocal blending). Checked the real impact via the new
  catalog-composition harness case rather than estimate it: at 30mm, 72/72
  progressive-ready frames clear (the existing generator floor was already
  exactly 30, so the old value filtered nothing); at 32mm, 67/72 clear (47
  non-sunglasses); at 44mm, 26/72 clear (16 non-sunglasses). **This corrects
  an earlier estimate of "72→23, 13 non-sunglasses" at 44mm — verified
  figures are 26 and 16.** 44mm is clinically the more defensible number but
  drops the catalog too far to keep the progressive-rimless intentional gap
  meaningful (there'd be almost nothing progressive-ready left to be
  rimless). 32mm is a defensible floor for short-corridor progressives, not
  a rejection of the optician's number.
- **`HIGH_INDEX_RX_THRESHOLD_D = -3.00`** (was -4.00; optician says -2.00).
  Unweighted midpoint. Flagged explicitly because the source has a
  commercial position and -2.00D sells more lens upgrades — that doesn't
  make it wrong, but it's reason enough not to adopt it outright without
  independent confirmation.

**Known consequence, not a bug:** the catalog's own generator baked in a
30mm progressive floor and a -4.00D rimless cap when it built the 100 rows
(§4 composition rules). Those weren't regenerated. Five catalog frames are
tagged `progressive_ready: true` at 30–31mm lens height and will now fail
the tightened 32mm rule despite the catalog's own tag saying they qualify —
a real tension between static data and a live threshold, worth a line in
the write-up about what happens when domain rules move faster than the
dataset they're checked against.

Golden-set cases for both thresholds are in `evals/golden/physical.json`
(`catalog_composition_cases`, `derivation_function_cases`) and run via
`npm run eval`.

## 2026-08-28 · Fit-rule correction: splaying/pressing, not "slipping = too wide"
Adopted outright — strictly better than what was there. The old derivation
table conflated two different physical complaints under `fit_issues ∋
slipping`: width fit and vertical slide. Corrected diagnostic: **temple arms
splaying outward means too small; temple arms pressing inward means too
wide.** Slipping down the nose is a separate mechanism entirely — nose pad
type, frame weight, pantoscopic tilt — and has nothing to do with frame
width.

`fit_issues[]` gained two new values to make this codeable
(PROJECT_CONTEXT.md §3 Slots): `splaying` and `pressing`, alongside the
existing `slipping` (now scoped to vertical sliding only). Also added
`cheekbone_contact` for the new rule below. See the updated derivation table
in PROJECT_CONTEXT.md §3.

## 2026-08-28 · Seven new physical derivation rules
All `claim_type: physical`, all mapped to existing catalog columns — no new
columns needed. Added to PROJECT_CONTEXT.md §3:

1. **Frame width invariant** (not a derivation rule, a validation fact):
   verified `frame_width_mm ≈ 2×lens_width_mm + bridge_mm + [4,8]mm` across
   all 100 catalog rows (mean +6.1mm, σ=1.34, consistent with hinge/endpiece
   allowance, never negative). Holds as a lower bound, not an identity — a
   sanity check for future catalog rows, not a filter.
2. Bridge/DBL: close-set eyes → boost `bridge_mm ∈ [14,18]`; wide-set eyes →
   boost `bridge_mm ∈ [19,22]` (catalog spans 14–22, so both ends are
   reachable). Soft, not hard — comfort preference, not a fit failure.
3. Flat nose profile → `nose_pad_type = adjustable` (hard — prevents pad
   contact with eyelashes).
4. Prominent nose bridge → prefer `nose_pad_type = fixed_integrated` ∧
   `material = acetate` (soft).
5. Long face (`length ≥ 1.5 × width`) → boost taller `lens_height_mm` (soft,
   same tier as the existing face-shape boost).
6. Lower rim resting on cheekbones / frame "jumps" when speaking → new
   `fit_issues ∋ cheekbone_contact` value, caps `face_width_fit` one size
   narrower (hard — reuses the existing `face_width_fit` column rather than
   inventing a new one).
7. AR coating critical specifically on high-index lenses → tied to the same
   `rx_power ≤ HIGH_INDEX_RX_THRESHOLD_D` trigger as the rim-type rule.
   No catalog column for lens coatings beyond `blue_light_ready`, so this is
   advice-copy only (`soft + advice`, same tier as the existing
   computer/screen_hours row), not a frame filter.

## 2026-08-28 · Deferred: complexion/undertone styling advice
Not adopted, not scheduled. The optician source covers real
complexion-to-frame-color guidance (light tortoise vs. dark skin, the
wrist-vein test for gold/silver metal tone) — but it's `claim_type: opinion`
by our own new rule, and separately, wiring it in means asking users a
skin-tone question in the conversation flow, which is a product decision
this project hasn't made deliberately. Not adding it just because the source
material happens to cover it. Logged in PROJECT_CONTEXT.md §11.

## 2026-08-28 · Future work: "eyewear wardrobe" framing
Not built. The optician's framing — one pair for everything is itself a
common failure mode — maps cleanly onto the existing `purpose_tags[]` slot
with no new data needed. Possible feature: recommend a primary pair, then
name the second use case it explicitly won't cover. Capturing the idea now
so it isn't lost; not scoping it into any current phase. Logged in
PROJECT_CONTEXT.md §11.

## 2026-08-28 · Phase 2 harness started: constraint-violation assertions, no LLM judge
Built the first slice of the eval harness ahead of the full golden sets, per
PROJECT_CONTEXT.md §2 phase ordering ("harness before golden sets are
complete" is fine — full golden sets, not the harness itself, are what has
to wait). `app/lib/constraints.ts` defines typed hard constraints
(`max_price`, `material_equals`, `requires_in_stock`,
`requires_purpose_tag`, `requires_polarized`, `requires_rim_type`,
`requires_progressive_ready`, `requires_uv400`) and checks them as direct
field comparisons against a `CatalogFrame` — no LLM grading anything.
`evals/golden/physical.json` seeds five query cases (the Phase 1 baseline
queries, now with explicit constraint specs) plus the two threshold
sensitivity cases above. `app/scripts/run-eval.ts` (`npm run eval --
--pipeline=naive`) runs each query through the pipeline, checks both the
retrieved top-5 and the frames the model actually recommended (SKU-mention
regex, falling back to `[n]` bracket-reference mapping when the model
doesn't cite SKUs verbatim — needed in practice, gpt-5.6-luna's answers
don't consistently include SKU strings the way gpt-4o-mini's did), and
writes a full JSON report to `evals/harness/reports/`.

This is what converts the qualitative Phase 1 transcripts into numbers:
retrieved-set pass rate was 0/5 on all three intentional-gap queries and
3/5 on the control query; recommended-frame pass rate was 0/1, 0/3, 0/2 on
the gap queries and 3/3 on the control (see the harness re-run entry above
for the fifth query's nuance).

**Repo-structure call, logged because it deviates from §8's stated
layout:** the harness's actual code (`constraints.ts`, `run-eval.ts`) lives
in `app/lib` and `app/scripts`, not `evals/harness/`, so it can import the
pipeline code directly and run under the app's existing `tsx`/TypeScript
setup without a second Node package. `evals/` keeps the golden-set data
(`evals/golden/physical.json`) and generated reports
(`evals/harness/reports/`), which is what actually needs to be inspectable
independent of implementation. Revisit if the harness needs to test a
pipeline outside this Next app (e.g. a future non-JS component).

## 2026-08-28 · Refusal-set framing correction: bare refusal is not the target
Per the relaxation ladder (PROJECT_CONTEXT.md §3), the correct behavior on a
constraint-violating-but-answerable query is to name the violated constraint
and offer the nearest alternative, saying explicitly what was dropped — not
to decline outright. Scoring bare refusal as "correct" in the refusal golden
set would optimize toward a system that's honest but useless. Reserve actual
refusal for the safety-interrupt cases, where declining to recommend
anything really is correct. Written into PROJECT_CONTEXT.md §6 directly so
future golden-set grading doesn't have to rediscover this. The gpt-5.6-luna
re-run's query #5 answer (see above) is a live example of the distinction:
it names the constraint and offers alternatives correctly, but still fails
the harness on a different axis (mislabeling purpose tags) — a reminder that
"good framing" and "constraint-compliant" are separate things to grade.

## 2026-08-28 · Corrected two errors in the Phase 1 evidence write-up
`docs/phase1-baseline-failures.md`'s natural-experiment section claimed the
Basalt Form 448 score shift (0.527 → 0.539) was "smaller than the gap
between adjacent ranks in either list." Checked against the report JSON:
false — it's larger than every adjacent gap in both lists (max gap 0.0077,
shift 0.012). Corrected to the stronger true claim: the score *rose* and
the rank *improved* (3rd → 2nd) at the exact query where the frame stopped
being valid — a real, if small, directional signal, and the direction is
backwards.

Also corrected "essentially blind to which number follows under ₹" — the
retrieved-set average price does move with the stated ceiling (₹7,110 at
₹8,000 vs. ₹6,400 at ₹4,500), just weakly and not reliably in the right
direction. Reframed as weak-and-uncorrelated rather than absent, and tied
to why the control query passed: a retriever that's sometimes right on
price is more dangerous than one that's never right, because it's the
reason a near-miss answer reads as plausible.

Added, not corrections but under-stated findings: a "Better prose, worse
compliance" section tabling how prose framing and constraint compliance
moved in opposite directions across the model swap (the direct answer to
"why not just use a stronger model" — a more fluent model narrates more
plausibly around a violated constraint instead of hitting the wall that
made the weaker model refuse); and a named defect class for the
`outdoor`/`sports` purpose-tag substitution that appears on both models
across two queries, flagged as a one-line SQL fix no model upgrade
addresses. Also cleaned two lines of stale framing that predated the
refusal-correction entry above and contradicted it, and added a summary
table (5 queries × 2 models × retrieved/recommended pass rate) at the top.

## 2026-08-28 · Refusal-and-safety golden set started (15 cases)
`evals/golden/refusal.json` — 7 safety-interrupt cases (astigmatism,
floaters, lazy eye, sudden flashes, sudden monocular blur, double vision,
detached retina) and 8 constraint-violation cases (the three intentional
catalog gaps, sports-under-₹500, plus four new ones verified against the
catalog: no frame under ₹1,000 catalog-wide, no rimless frame supports
-6.00D, no sunglasses under ₹1,200, and a category-mismatch case —
reading glasses here are fixed-power, not Rx carriers, so "progressive
reading glasses for my -3.00 prescription" needs an explanation, not an
inventory search).

Not wired into `app/scripts/run-eval.ts` — unlike `physical.json`, this
set's correct behavior is a property of the prose (did it name the
violated constraint, offer an alternative, decline safely and refer out)
that a field-comparison check can't grade. Needs human or rubric review,
same as the style-fit set — PROJECT_CONTEXT.md §6 flags that human
dependency deliberately, this is it arriving for a second golden-set
category.

## 2026-08-28 · Golden set ground truth was circular
`evals/golden/refusal.json`'s `gap3-titanium-under-4500` case claimed the
nearest miss to "titanium under ₹4,500" was Basalt Form 448 at ₹4,800 (a
₹300 gap). Checked against the full catalog: wrong. The actual cheapest
titanium frame is Nira Edition 292 at ₹4,600 (a ₹100 gap) — Basalt is tied
for 2nd cheapest, not 1st. The file already stated "all titanium frames
start at ₹4,600" two sentences above the ₹4,800 claim and contradicted
itself; nobody had checked the two sentences against each other, because
neither had been checked against the catalog. The same unverified pattern
was present, more weakly, in `physical.json`'s copy of the same case.

**Why this happened is the finding, not the fix.** Basalt Form 448 is the
frame the naive Phase 1 baseline actually retrieved and discussed at length
in `docs/phase1-baseline-failures.md` — it's the frame that was *visible*
while writing these golden cases, so it became the frame the ground truth
was written around. Nira Edition 292 never appeared in any top-5 (cosine
similarity ranked it outside the retrieved set for that query), so it was
never seen, so it was never considered. The golden set's "ground truth" was
quietly inherited from the failing pipeline's output instead of computed
independently from the catalog.

**The consequence is concrete, not hypothetical.** Phase 3's hybrid system
will query the catalog directly with SQL, will correctly surface Nira
Edition 292 at ₹4,600, and would have been marked *wrong* by this rubric
for finding the actually-correct answer that Phase 1's broken retrieval
missed. An eval built this way doesn't just fail to catch the naive
baseline's bug — it forbids the fix from scoring better than the bug. The
general lesson: **eval ground truth derived from the system under test
silently caps the ceiling of anything that outperforms it.** Ground truth
has to come from an independent source of authority over the domain — here,
a direct catalog computation; in other projects, a spec, a human expert, or
a separate reference implementation — never from "what the system being
graded happened to produce," even when that output looks plausible and even
when it's the thing sitting right in front of you while you write the case.

**Fix, made systematic rather than case-by-case:** added
`app/lib/nearest-miss.ts` (`computeNearestMisses`) and
`app/scripts/generate-nearest-miss.ts` (`npm run nearest-miss`). For every
`constraint_violation_case` with 2+ constraints, it relaxes exactly one
constraint at a time, holds the rest fixed, and takes the cheapest catalog
frame that now qualifies — a `nearest_miss` field, generated from
`data/catalog/out/catalog.json` directly, never hand-typed. Re-running it
after any catalog change keeps every case's ground truth correct by
construction instead of by memory. Audited every other
`constraint_violation_case` in `refusal.json` against the same failure
mode while fixing this one:

- `sports-under-500`'s `expected_behavior` cited "the cheapest catalog
  frame (₹1,150)" as the reference point — that frame isn't sports-tagged,
  so it wasn't a real answer to a sports-sunglasses query. The correct
  reference is the cheapest frame that *is* sports-tagged (Wren Edition
  729, ₹2,150) — a materially different number now supplied by the
  generator.
- `sunglasses-under-1200` turned out to be a boundary artifact, not a real
  gap (separate issue, same root cause: nobody checked the exact price
  against the catalog before writing "under ₹1,200" — the cheapest
  sunglasses is exactly ₹1,200, so the strict inequality manufactured a
  fake empty result). Retargeted to `sunglasses-under-1100`, a genuine
  ₹100 gap, and gave it the same generated treatment.
- `any-frame-under-1000` and `rimless-strong-prescription` were already
  correct (verified against a full catalog scan when written, not against
  retrieval output) but only have one real constraint each, so "nearest
  miss" degenerates to "cheapest frame in the catalog" — not a meaningful
  answer to either query. Left hand-verified and explicitly excluded from
  the generator, with the reasoning written into each case's `note` field
  so a future auditor doesn't have to re-derive why they're missing a
  `nearest_miss` array.
- `reading-glasses-with-prescription` has no `violated_constraints` by
  design — it's a category-mismatch case (reading frames are never
  Rx-compatible here), not a filter-relaxation case, so the generator
  doesn't apply.

Also cleaned `physical.json`'s `sports-under-500` note, which still said
"even the naive baseline refuses correctly" — disproven by the
gpt-5.6-luna re-run and inconsistent with the refusal-framing correction
already logged above. Both files now agree: this case checks hard-constraint
compliance only, not refusal behavior, which is `refusal.json`'s job.

This belongs in the case study as its own section, not folded into a
methods footnote — it's a stronger demonstration of eval-design maturity
than most of the harness work: catching your own eval before it caught (or
rather, failed to catch) the system.

## 2026-08-28 · Phase 3 started: catalog → SQL half only, advice → RAG half blocked
Built the catalog-query half of the hybrid architecture (`PROJECT_CONTEXT.md`
§1) and ran the real A/B against Phase 1's naive baseline
(`docs/phase3-hybrid-ab.md` has the full evidence). Did not build the
advice → RAG half: `data/advice/` is still empty, and the standing decision
not to fabricate that corpus with an LLM stands. `app/lib/pipelines/hybrid.ts`
is catalog-only and says so in its own header comment — this is a
documented gap, not a silent one. It's also single-turn (one query, one
answer), matching the naive pipeline's shape for a fair comparison, not
the full multi-turn conversational slot-filling layer in §3 (rx_power
derivation, the five-question cap, etc.) — that's a larger feature for
later.

**Real SQL, not a JSON filter pretending to be one.** `node:sqlite`
(built into Node 22+, confirmed working on this Node 24 install) builds
`data/catalog/out/catalog.db` from the catalog
(`app/scripts/build-catalog-db.ts`) with a proper `frame_purpose_tags`
junction table, so "does this frame have the sports tag" is a real SQL
`EXISTS` join, not a text match. Bumped `@types/node` to `^24` to match
the actual runtime and get sqlite typings. Rejected a real database
server or an ORM at this scale — same judgment call as Phase 1's
in-memory vector store: 100 rows doesn't need infrastructure the naive
baseline didn't need either.

**Mechanism:** function-calling extracts a structured filter from the
query (`extract_filter` tool) → compiles to parameterized SQL
(`app/lib/catalog-db.ts`) → if zero rows, the relaxation ladder
(`findNearestAlternatives`) drops exactly one clause at a time and returns
the cheapest frame that qualifies once that clause is dropped, mirroring
`app/lib/nearest-miss.ts`'s approach for the golden set but applied live.
Generation reuses the naive pipeline's bracketed-reference convention and
blurb text (`getBlurb`) so a difference in outcome is attributable to
which frames were selected, not how they're described.

**Model-sharing refactor:** pulled `CHAT_MODEL`/`CHAT_TEMPERATURE` out of
`naive.ts` into `app/lib/config/model.ts`, imported by both pipelines --
required so the A/B isolates retrieval mechanism as the only variable.
Also hit a real API constraint fixing this: `gpt-5.6-luna` rejects
function tools on `/v1/chat/completions` unless `reasoning_effort` is
explicitly set to `"none"` (confirmed against the live API). Set that
only on the extraction call, not the generation call, so the fix doesn't
retroactively change the naive pipeline's already-published behavior.

**Result, in short (full writeup in docs/phase3-hybrid-ab.md):** on the
control query, hybrid's retrieved set is 5/5 constraint-compliant vs.
naive's 3/5, and surfaces Nira Edition 292 (₹4,600) — the catalog's
actual cheapest titanium frame, which naive has never surfaced in any
run logged in this project. On all four queries where nothing satisfies
the full constraint set, hybrid's relaxation-ladder alternatives match
`refusal.json`'s independently-generated `nearest_miss` ground truth
**8 for 8**. Naive's ad hoc substitutions match **zero** verified-correct
alternatives, and reproduce the outdoor/sports mislabeling defect twice
in this run alone; hybrid's equivalent answers, same chat model, same
temperature, get both right, because SQL checked tag membership before
the model ever saw the candidate. This is the concrete version of
`PROJECT_CONTEXT.md` §1's abstract claim, not just an assertion of it.

**Known gap surfaced while building this, not yet fixed:** the model's
filter extraction infers `product_type` (e.g. "sports **sunglasses**" →
`product_type: sunglasses`) for two of the five golden queries, but
neither `physical.json` nor `refusal.json` encodes that constraint for
those cases. Didn't change any number in this run (every relevant frame
already happens to be `sunglasses`), but it's the same category of gap
`sunglasses-under-1100` was fixed for two commits ago, just not yet
tripped. Flagging rather than fixing now to avoid scope creep on an
already-large commit; worth closing before this table is relied on for
anything beyond what it currently claims.

## 2026-08-29 · Ordered categorical relaxation, and Result 3 reframed as a consistency check
Two fixes to the relaxation ladder, both landed in `app/lib/nearest-miss.ts`
(the golden-set generator) and `app/lib/catalog-db.ts` (the live hybrid
pipeline) identically.

**Ordered domains.** Relaxing `rim_type` or `material` used to drop the
constraint straight to "any value" and take the cheapest frame regardless
of category. Now it walks an ordered domain
(`app/lib/config/domains.ts`: `rimless → semi → full`,
`titanium → metal → {tr90, acetate}`) one tier at a time. Concrete effect,
verified by re-running both implementations: relaxing gap #2's `rim_type`
requirement now resolves to Kestrel Edition 850 (semi-rim, ₹1,350) instead
of Halcyon Type 165 (full-rim, ₹1,150) — one category step from rimless
instead of two, and it's the cheapest option *within* that nearer tier, not
just the cheapest option overall. Relaxing gap #3's `material` requirement
now resolves to Truss Series 377 (metal, ₹1,300) instead of Halcyon Type
165 (tr90, ₹1,150) — one step from titanium instead of two. Domains are
exhaustive over the catalog's actual values, so this is a strict
refinement of the old behavior, not a different fallback: walking every
tier is equivalent to the old "drop entirely," it just tries the nearer
tiers first.

**Result 3 in `docs/phase3-hybrid-ab.md` was overclaiming.** It called
agreement between the golden-set generator and the live SQL pipeline
"independently-verified ground truth." That's wrong: both are the *same
algorithm* (relax one constraint, walk the ordered domain, take the
cheapest qualifying frame) implemented twice — once as an in-memory JS
filter, once as live SQL. Agreement between them is a **consistency
check** — it confirms the two code paths aren't buggy relative to each
other, and specifically that the ordered-domain fix above didn't
introduce drift between them. It does not independently validate that
"cheapest frame after relaxing exactly one constraint, nearest category
first" is the *right* notion of nearest miss — that's a design choice
both implementations share, not an externally verified fact. What's still
legitimately true, and worth keeping: both are computed directly from the
catalog, so neither inherits the circularity bug that produced naive's
wrong answers (Basalt Form 448 instead of Nira Edition 292, etc. —
"golden set ground truth was circular," 2026-08-28). Relabeled the
section and the table accordingly; re-ran the full A/B on the updated
relaxation logic rather than patch old numbers.

## 2026-08-29 · Threshold research resolved the progressive disagreement
The 30mm-vs-44mm fight was never really a disagreement about the right
number — it was two different measurements being compared as if they were
one. Verified by fetching and reading the actual source documents (PDFs
downloaded directly, decrypted where needed, text extracted with `pypdf`
after `pdftoppm`/poppler wasn't available in this environment; two of six
source URLs had gone dead since being cited and were recovered via
web.archive.org):

- **Fitting height** (pupil centre to lens bottom): 14–20mm across every
  vendor checked — Rodenstock 16/18/20mm, Zeiss 14/16/18mm, HOYA
  14–21mm, Vision Council EPIC entries sampled at 13–18mm across three
  manufacturers.
- **Frame/B-height** (the full vertical lens opening — what this
  catalog's `lens_height_mm` column and `PROGRESSIVE_MIN_LENS_HEIGHT_MM`
  actually measure): 24–34mm per Rodenstock's Table 2-3, 25–30mm per
  OptiCampus ("minimum depth... labelled 'Depth B'" in the source
  diagram).

Our own 30mm default and the optician's 44mm were each being measured
against the *other* quantity implicitly, which is exactly the error that
produces a factor-of-1.5 disagreement out of numbers that are individually
reasonable. **The optician's 44mm could not be substantiated in Rodenstock,
Zeiss, or HOYA documentation** — their own longest-corridor and
near-comfort product lines top out at 34–36mm, nowhere near 44mm. Recorded
as unsupported, not as a stricter alternative that lost a coin flip.

Kept 32mm, but re-provenanced and renamed (`PROGRESSIVE_MIN_B_HEIGHT_MM`,
so the B-height/fitting-height distinction can't be silently re-conflated
by a future edit) rather than treated as resolved-to-one-true-number: the
sources themselves give a range depending on corridor length, and 32mm
sits inside Rodenstock's documented range, just above OptiCampus's
general-purpose figure. Full citations in `data/advice/` (see below).

**The finding that actually matters for the write-up:** parameterising
this threshold instead of adopting either party's number outright is what
kept the mistake from becoming expensive. Had 44mm been adopted directly
back on 2026-08-28 without a config constant to isolate it, the
consequence — only 26 of 100 catalog frames clearing the bar (16
non-sunglasses), down from 72, nearly collapsing the progressive-ready
query class and making the progressive-rimless intentional gap
meaningless — would have been baked into query logic across the
codebase instead of visible as one number in one file, checked by one
golden-set case (`evals/golden/physical.json`,
`progressive-lens-height-threshold-sensitivity`) that made the
consequence impossible to miss before it shipped. The lesson isn't
"32 was the right guess" — it's that isolating a contested number behind
a named constant with a test that shows its blast radius is what turns a
wrong external claim into a caught one instead of a shipped one.

## 2026-08-29 · High-index lens recommendation is a function, not a threshold
Replaced `app/lib/derivation.ts#deriveRimTypeConstraint` (a single scalar
Rx-power cutoff) with `assessLensIndex(rxPowerD, lensWidthMm, rimType)`.
A single threshold can't represent two real effects:

- **Sag depth scales with roughly diameter².** A large lens needs the
  high-index recommendation earlier (at a lower |Rx|) than a small one at
  the same power. `LARGE_LENS_WIDTH_MM = 55` (75th percentile of this
  catalog's `lens_width_mm`, verified 2026-08-28) pulls every tier
  boundary earlier by `SIZE_SHIFT_D = 1.0`D when crossed; a semi/rimless
  mount on a minus lens adds a further `EDGE_EXPOSURE_SHIFT_D = 0.5`D
  (more edge is visible to begin with).
- **Minus lenses are edge-thick; plus lenses are centre-thick.** The same
  |Rx| doesn't mean the same thing for +3.00 and -3.00.
  `PLUS_LENS_SHIFT_D = 1.5`D delays the tier boundary for plus power, and
  — more importantly — plus power **never** triggers the
  `requiresNonRimless` hard constraint in this model, regardless of
  magnitude, because plus-lens edges stay thin regardless of power; the
  rimless/edge-drilling concern is a minus-lens-specific physical fact,
  not a symmetric one.

Verified live (`npm run eval`, `lens-index-frame-size-interaction` golden
case): at the identical -3.00D prescription, a small (48mm) full-rim frame
lands in tier "consider" (`requiresNonRimless: false`) while a large
(58mm) rimless frame at the same power lands in "recommended"
(`requiresNonRimless: true`) — same Rx, different recommendation, which
is the whole point. At +3.00D, neither configuration trips
`requiresNonRimless`, confirming the plus/minus asymmetry holds.

**Rimless is capped at 1.67 regardless of tier, and this is not a hedge.**
Sourced to a real tensile-strength table found in TTUHSC's rimless-eyewear
CE course (`data/advice/ttuhsc-rimless-lens-materials.md`): 1.74 measures
31.6 kgf tensile strength, against 1.67's 67.3 kgf and 1.60's 80.5 kgf —
under half of either. The table recommends 1.74 for high-Rx thinness, not
for drill-mount durability; the function only claims the first, and says
so in its `reason` field. This is exactly the encoding the brief asked
for: don't recommend the highest index for rimless just because it's
thinnest.

Tier boundaries (`LENS_INDEX_TIER_BOUNDARIES_D`: consider 2.00D, recommended
4.00D, high 6.00D) are taken as given for this pass, not independently
verified against a named source the way the B-height figures and the
tensile-strength table were — flagging that distinction so it isn't read
as equally sourced.

`evals/golden/physical.json`'s derivation case rewritten from a
single-function threshold sweep to a 4-scenario matrix (small/large ×
+/-3.00D) exercising the actual interaction; `app/scripts/run-eval.ts`
updated to match the new function signature and case shape.
`PROJECT_CONTEXT.md` §3's derivation table and §6's golden-set description
updated to describe the function-based system instead of the retired
scalar constants.

## 2026-08-29 · Advice corpus started from six verified primary sources
`data/advice/` was empty since Phase 0. Populated it properly this time —
every document below was fetched and read in this session, not written
from training-data recall, per the standing decision against fabricating
this corpus (2026-08-27).

1. **Rodenstock, *Tips & Technology 2022*** — downloaded 11MB PDF directly
   (WebFetch alone hit a 10MB response-size limit), extracted with
   `pypdf`. Table 2-3 and the fitting-height-by-progression-length figures.
2. **Rodenstock, *Instructions for use — Progressive lenses* (Jan 2022)**
   — the +2mm/+8mm grinding-height formula.
3. **OptiCampus, *Progressive Lens Dispensing*** (Darryl J Meister, 2008)
   — AES-encrypted PDF (permissions-only; `cryptography` package
   installed to decrypt with `pypdf`). The "25-30mm... Depth 'B'" figure
   and fitting-height measurement-error guidance (parallax, "fudging").
4. **ZEISS, *Precision Progressive Range Portfolio Brochure*** — live URL
   404'd; recovered via web.archive.org (2018-03-29 snapshot). 14/16/18mm
   fitting heights for the Precision Pure/Plus/Superb line.
5. **HOYA, *2026 Product & Technology Reference Guide*** — 36-page PDF,
   fitting heights for the Array/Amplitude free-form lines.
6. **The Vision Council, EPIC** (Electronic Progressive Identifier
   Catalog) — 3,326-page lens-identification lookup tool, not a guidance
   document; read front matter plus three sampled entries (Essilor,
   Nikon, Signet Armorlite) rather than exhaustively, and said so in the
   document's own frontmatter rather than implying full coverage.
7. **TTUHSC, *The Art and Science of Rimless Eyewear, Part 1*** (2018 CE
   course) — live URL 404'd; recovered via web.archive.org (a 2026-04-12
   snapshot — the archive outlived the source by years). The drilled-rimless
   material tensile-strength table this session's high-index function
   relies on.

All six tagged `claim_type: physical` per project convention, each with
`source_url`, `verified` date, and `verification_method` in frontmatter so
a later auditor can tell what was actually read versus summarized.
**Not yet done:** Essilor was named as a cross-check source for the
progressive-height claim but not located; the "44mm unsupported" finding
above rests on the four sources that were found, not five. No documents
yet on face-width fitting, material skin-sensitivity, or the other §5
topics PROJECT_CONTEXT.md lists — this corpus start covers exactly the
two disputes this session's threshold work needed, not the full ~40-60
document target.

## 2026-08-31 · Phase 4, part 1: vocabulary policy written into PROJECT_CONTEXT.md §3
Before building anything: the average user doesn't know what a rim type,
lens index, or `nose_pad_type` is, and the architecture already agreed
with that in spirit (none of those appear in the Slots table) but never
said so as policy, which meant nothing stopped a future slot addition
from quietly violating it. Wrote three explicit rules into §3: no question
may require vocabulary the user isn't expected to have; technical
attributes are derived, never solicited; every technical term in output
must be explained in the same sentence it appears. Added a lay-language
rewrite of every conversation question (§3 "Question phrasing" table) --
not "what's your prescription power" but "do you wear glasses now, and do
you know roughly how strong?"

**The honest tension, handled rather than hidden:** fewer technical
questions means less information, and sometimes a wrong derivation.
Someone at -5.00D who doesn't know their power can't safely be handed a
rimless frame, but demanding a number they don't have isn't the fix
either. Resolution: proceed on a stated, named assumption and say what
changes if it's wrong -- not a new idea, this is the existing
"assumed values must be surfaced" rule, applied specifically to the case
where the missing information gates a hard constraint. Two golden cases
added (`evals/golden/refusal.json`, `assumption_surfacing_cases`): one
where the unknown prescription actually matters (rimless request), one
where it doesn't (reading glasses, which are fixed-power in this catalog
regardless of Rx) -- included specifically so a system that hedges on
reflex, rather than because the missing fact actually gates something, is
caught rather than rewarded for over-caution.

## 2026-08-31 · Phase 4, part 2: advice corpus chunked and embedded, documents only
`app/scripts/build-advice-chunks.ts`: one chunk per H2 section across
`data/advice/*.md`, 19 chunks from 6 documents. Deliberately NOT the
catalog -- chunking and embedding the catalog would rebuild the exact
naive-baseline architecture Phase 1 was built to disprove; the catalog
stays in SQLite behind `WHERE` (Phase 3), full stop.

Section boundaries were chosen as the chunk unit because they're the
actual safe split points in this specific corpus: every table in every
document lives entirely inside one H2 section (verified by inspection
before writing the chunker, and re-verified programmatically at chunk time
via a header-separator-row check), so section chunking keeps every table
intact without needing separate table-extraction logic. Every chunk is
prepended with `{document title} — {section heading}` before embedding --
"16mm minimum, 24mm frame height" is meaningless without knowing it's
Rodenstock's design table, not a competitor's or a different measurement
entirely.

**A real authoring gap, caught by the chunker refusing to guess.** The
chunker throws rather than silently drops content if it finds prose
between a document's H1 title and its first H2 -- and it did, once: the
Vision Council EPIC document had a real paragraph there. Fixed the source
document (added a heading) rather than adding a special case to the
chunker to paper over it. This is the same discipline as the earlier
table-integrity check: catch structural assumptions failing loudly, at
build time, not silently at query time.

**`claim_type: opinion` exclusion actually runs, even though it currently
matches nothing.** No opinion-tagged documents exist in this corpus yet
(all 19 chunks are `physical`), so the filter has zero visible effect
today -- but the code path that would filter it out is real and tested
(`build-advice-chunks.ts` throws on any claim_type it doesn't recognize,
and explicitly skips `opinion`), not just documented policy waiting to be
implemented later. When an opinion-tagged source is eventually added,
correctness doesn't depend on remembering to write the filter then.

**Known gap, honest about it:** all 19 chunks are `claim_type: physical`.
The `convention` register/authority behavior (PROJECT_CONTEXT.md §3, the
runtime-function entry below) is implemented and instructed in the system
prompt, but cannot currently be exercised through live retrieval, because
no convention-tagged source exists in this corpus -- the corpus is
6 vendor technical documents, not style guidance. Validated the hedging
judge against a synthetic convention chunk instead (clearly labelled
fictional, "Style Reference Co.", never mixed into the real corpus) --
see the judge-validation entry below. A real convention source (face-shape
styling, deferred 2026-08-28 for unrelated reasons) would close this gap
properly; noting it rather than letting the corpus's current composition
imply more coverage than it has.

## 2026-08-31 · Phase 4, part 2 (cont.): claim_type is a runtime function, not a tag
Three jobs, all now real code, not just PROJECT_CONTEXT.md prose:
**register** -- the orchestrated system prompt (below) instructs physical
claims stated plainly with a citation, convention claims hedged and
explicitly named as convention, and every advice reference passed to the
model is labelled with its claim_type inline
(`app/lib/pipelines/orchestrated.ts#formatAdviceContext`); **authority**
-- physical claims may drive the hard SQL constraints in
`app/lib/catalog-db.ts`/`app/lib/constraints.ts`, convention claims may
only nudge ranking, generalizing the existing face-shape rule (soft,
+0.15 max, decisions.md 2026-08-27) from a special case into policy;
**exclusion** -- covered above. The hedging-match LLM judge (below) is
what actually checks whether register is followed, not just instructed.

## 2026-08-31 · Phase 4, part 3+4: orchestrated pipeline and the warmth-is-confidence hazard
`app/lib/pipelines/orchestrated.ts`, registered as a third pipeline
(`naive` / `hybrid` / `orchestrated`) in `app/lib/pipelines/index.ts` so
`npm run eval -- --pipeline=both` now compares all three. Frame selection
(extraction, SQL, relaxation ladder) is identical to `hybrid.ts` --
factored the shared `extractFilter`/`EXTRACTION_TOOL` out to
`app/lib/pipelines/extract-filter.ts` so the two pipelines can't drift on
what counts as a valid filter. What's new is a second retrieval pass over
advice chunks folded into the same generation call, and a system prompt
built around a specific hazard: warmth reads as confidence. "Those will
look amazing on you" is an unhedged claim in a friendly voice, and the
friendliness makes it harder to notice than the same claim said flatly
would be.

Persona is stated first in the prompt; eight numbered constraints are
stated second, explicitly, in writing -- not folded into the persona
paragraph where they'd be easy to read past. Constraint 5 names the
hazard directly: if the customer is excited about something that fails a
hard requirement, acknowledge the excitement and state the disqualifying
fact plainly, in the same breath, because warmth belongs in delivery, not
in softening the fact. Two golden cases test this directly
(`evals/golden/refusal.json`, `persona_constraint_conflict_cases`).

**Real transcript, not a hypothetical:** "I have a strong prescription,
around -6, and I really want rimless glasses because they look so light.
Will that work?" got: "I understand why you like the rimless look... But
at around -6.00D, none of the rimless frames in this catalog meets your
prescription requirement" -- named specifically, per-frame, with the
actual limits, not softened. Held on the first real run, before any
prompt iteration. Kept as a golden case specifically so a future prompt
change that erodes this doesn't just get noticed once and forgotten.

A ninth constraint was added after the judge-validation process (below)
found a real domain bug: the prompt now explicitly distinguishes
`lens_height_mm` (frame/B-height) from "fitting height" (a different,
smaller advice-sourced figure) -- see that entry for what this fixed.

## 2026-08-31 · Phase 4, part 5: LLM judges, validated -- and the validation caught more real bugs than it validated the judges
`app/lib/judges.ts`: three judges (groundedness, citation accuracy,
hedging-matches-claim-type), structured output with a `reasoning` field
generated before `verdict` (binary pass/fail, not a 1-5 scale -- a scale
invites averaging away exactly the disagreement a judge exists to
surface). These are the first LLM judges in this project, used
specifically because these three properties are properties of prose that
`app/lib/constraints.ts`'s deterministic field comparisons can't grade --
the contrast is deliberate and belongs in the case study: deterministic
checks for the catalog half, validated judges for the advice half, each
chosen because of what the data actually is.

**Hit a real API constraint immediately:** `gpt-5.6-luna` rejects
`temperature=0` outright ("does not support 0 with this model, only the
default (1) value is supported" -- confirmed against the live API). The
standard judge-determinism move isn't available on this model; judges run
at the same shared `CHAT_TEMPERATURE` as generation. Consequence, not
swept under the rug: judge verdicts are not perfectly reproducible
run-to-run, confirmed directly (see below) -- one more reason
`npm run validate-judges` needs to be re-run periodically, not treated as
a one-time gate passed and forgotten.

**Validation set: 15 hand-labelled examples**
(`evals/golden/judge_validation.json`) -- 6 real transcripts from actually
running `orchestrated.ts` on realistic queries, each hand-verified
claim-by-claim against `data/catalog/out/catalog.json` before labelling
(not skimmed); 9 constructed adversarial examples, because the 6 real
transcripts turned out to be consistently well-behaved on first read,
which is itself a "watch for a flattering result" moment -- an
all-real, all-positive validation set would say nothing about whether
these judges can actually catch a failure, only that this model usually
doesn't produce one. Constructed examples cover fabricated claims,
misattributed citations, hallucinated statistics, an invented product
name, and (since the real corpus has zero convention-tagged content) a
synthetic convention chunk used only in this validation set, clearly
labelled fictional, to actually exercise the hedging judge.

**First run: 40% / 71% / 100% agreement.** Investigated every
disagreement individually rather than assume the judge was wrong, and
found the judge was right more often than my hand labels were:

- The standout: a real transcript answering "progressive lenses, small
  face, will they fit in a small frame" compared the frames'
  `lens_height_mm` (34mm, 40mm) directly against a 16-20mm *fitting-height*
  figure from retrieved advice, treating clearing one as satisfying the
  other. The retrieved advice in the SAME context explicitly warns against
  exactly this conflation -- it's the precise distinction Phase 3's
  threshold re-provenance work (2026-08-29) was built around. First-pass
  hand label said this passed groundedness. It didn't. Fixed at the
  source: added constraint 9 to the orchestrated system prompt (above)
  stating the distinction explicitly; re-ran the identical query and
  confirmed the fix -- the new answer correctly separates the two
  measurements and says the optician still needs to measure fitting
  height directly.
- A real transcript said "The ₹3,000 price is for the frame only" when
  ₹3,000 was the customer's stated *budget*, not the ₹1,350 frame's price
  -- a genuine conflation, missed on first pass.
- A real transcript speculated that "tapered temples" aid fit adjustment
  (not established anywhere in context) and compared a recommended
  frame's weight against the customer's *unstated* current-frame weight
  -- both invented comparisons, missed on first pass.
- My own constructed "correctly hedged" positive-control example
  referenced "you also mentioned progressives" in a query that never
  mentioned progressives -- an authoring bug in the test, caught by the
  same run, fixed in the test rather than the system.

**Two judge-prompt corrections, both principled, not curve-fitting to
pass my labels:** (1) groundedness and citation-accuracy were
unintentionally overlapping -- a misattributed citation (right fact,
wrong bracket number) was failing both judges for the same underlying
reason, collapsing two dimensions I meant to be orthogonal. Refined
groundedness to mean "supported somewhere in the provided context,
regardless of which bracket number is attached" and citation-accuracy to
only grade claims that carry an explicit citation at all (an uncited
claim is purely a groundedness question). (2) Both judges were
initially failing brief, generic definitional elaboration of jargon
already present in context (e.g. "TR90, a thermoplastic material" when
the source just says "TR90") -- exactly the kind of explanation
PROJECT_CONTEXT.md §3's vocabulary policy *requires* the system to
provide. Carved that out of both prompts explicitly, while keeping
numbers, comparisons, and claims about unprovided information strictly
in scope.

**Final state, reported as-is, not re-run until clean:** groundedness
93% (14/15), citation accuracy 85% (11/13), hedging match 100% (3/3).
Two disagreements remain, both defensible alternate readings of
genuinely ambiguous prose (whether a frame correctly counts as "nearest
by size" when it's narrowest by one dimension and widest by another;
whether 1.67 counts as "very-high-index" against a source that only
explicitly names ">1.67" as "ultra-high-index") -- kept rather than
massaged away, because the goal was validating the judges, not producing
a clean number.

## 2026-08-31 · Two things that arrived free while building this
**Link rot, quantified.** 2 of the 6 advice documents (Zeiss, TTUHSC --
decisions.md 2026-08-29) had their live source URL return 404 between
citation and fetch, within the same week the corpus was assembled -- a
33% rot rate on sources cited days earlier. Both recovered via
web.archive.org (one snapshot from 2018, one dated 2026-04-12 -- the
archive outlived the live document by years in both directions). The
mitigation already existed by necessity, not by plan: every document's
frontmatter carries `source_url`, `verified` date, and
`verification_method`, and the two recovered ones additionally carry
`source_url_note` documenting the Wayback snapshot used. The general
lesson for the write-up: any system that cites external URLs as evidence
needs archived copies as a matter of course, not as a contingency, plus a
periodic link-check job to catch rot before a citation silently points at
nothing -- at this rate (2 of 6 in under a week), assuming citations stay
live is not a safe default.

**A real freshness asymmetry, worth measuring properly in Phase 6.**
Catalog changes (price, stock, a new frame) need no re-embedding at all --
`app/lib/catalog-db.ts` queries live SQL against whatever's in
`catalog.db`, so a changed row is correct on the very next query. Advice
changes require a full re-chunk and re-embed
(`npm run advice-chunks && npm run embed-advice`) before they're
reflected in retrieval at all, and nothing currently detects that an
advice document changed and the index is stale (no `content_hash`-style
staleness check exists for `data/advice/`, unlike the catalog's
`content_hash`/`stock_updated_at` fields built for exactly this in Phase 0).
This is a genuine, structural advantage of the SQL/RAG split beyond the
constraint-satisfaction argument Phase 3 already made: the half of the
system that changes constantly (stock, price) is also the half that's
cheapest to keep fresh, and the half that changes rarely (optical
guidance) is the half that's expensive to refresh. That pairing isn't a
coincidence to note in passing -- it's a real architectural argument for
Phase 6 to measure directly (simulate an advice-corpus update, time the
re-embed, compare against a simulated catalog price change) rather than
just assert. (Renumbered 2026-08-31 -- see PROJECT_CONTEXT.md §2: the
original plan's "Phase 3" bundled catalog-SQL and advice-RAG as one row;
splitting them after the fact pushed freshness from Phase 5 to Phase 6.)

---
<!-- next entry here -->
