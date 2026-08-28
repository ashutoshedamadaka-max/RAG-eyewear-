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

---
<!-- next entry here -->
