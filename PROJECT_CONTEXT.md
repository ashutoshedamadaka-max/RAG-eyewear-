# Eyewear RAG Recommender — Project Context

Read this first. It carries the decisions made before any application code existed,
so that work continues from the same premises rather than restarting them.

**Purpose:** portfolio piece for product manager applications to AI roles.
Two deliverables, both required: an interactive demo, and a written case study
covering the eval harness, golden sets, latency, and knowledge-base freshness.

**Status:** Phase 0 (data) and Phase 1 (naive baseline) complete — see
`docs/phase1-baseline-failures.md`. Phase 2 (eval harness) started —
constraint-violation checks are in (`evals/`, `app/lib/constraints.ts`);
refusal-and-safety golden set seeded at its full ~15 cases
(`evals/golden/refusal.json`, not yet graded — needs human/rubric review);
physical.json has 7 seed cases plus a frame-size-interaction derivation
case; style.json not started. Phase 3 started — catalog → SQL half built
and A/B'd against Phase 1 (`docs/phase3-hybrid-ab.md`); advice → RAG half
still not built, but `data/advice/` has 7 documents from verified primary
sources (§5) covering the two threshold disputes Phase 3 needed —
nowhere near the full ~40–60 target yet.

---

## 1. The premise, and the decision that matters most

A user talks to the system the way they would to a salesperson in an optical
store. Five or so questions, one at a time, ending in 2–3 recommended frames
with reasons and citations.

**The architecture is deliberately hybrid, not pure RAG.**

A frame catalog is structured data. Lens width, price, material, stock and
prescription range are columns, and vector search cannot answer "under ₹8,000,
titanium, fits a 62mm PD, in stock" — cosine similarity has no concept of a
numeric constraint. Embedding product blurbs and hoping is the failure mode of
most "AI recommender" demos and the first thing a technical interviewer probes.

The genuinely retrievable knowledge is the *optician's advice*: how frame width
relates to face width, why high-index lenses matter more at some
prescriptions and frame sizes than others (a function of Rx power, lens
size, and rim type, not one cutoff — see §3 derivation rules), why progressives need a minimum lens
height, what "my glasses keep sliding" actually indicates. That is unstructured,
citable, and it's what a good salesperson knows.

So:

```
Catalog  -> SQL / structured filters
Advice   -> RAG with citations
Agent    -> orchestrates both, explains picks using retrieved advice
```

**This split is the case study's central argument.** "I evaluated RAG for the
catalog, measured it against filtered search, and it lost — here is the eval that
showed it" is the strongest PM-shaped artifact in the project. Knowing when not
to use the technology is the seniority signal.

---

## 2. Non-negotiable build sequence

Do not skip or reorder these. The reasons are in each line.

| Phase | Work | Why it must come here |
|---|---|---|
| 0 ✅ | Catalog data | Done — see §4 |
| 1 | **Naive baseline**: pure vector RAG over everything, catalog included | Build it *knowing it will fail*. Its failure on constraint queries is the case study's opening scene and the baseline every later number is measured against. Screenshot the failures. |
| 2 | **Eval harness + three golden sets** | Before any optimisation. Without it every later "improvement" is superstition. |
| 3 | **Hybrid split**: catalog → SQL tool, advice → RAG | The A/B table against Phase 1 justifies the whole architecture |
| 4 | Retrieval quality: chunking, hybrid search, reranking — measured separately | Report which techniques helped and which didn't, with numbers |
| 5 | Freshness: simulate catalog churn, incremental re-index | Demonstrate the stale-stock bug, then fix it |
| 6 | Latency: instrument per stage, parallelise, stream | Budget before/after |
| 7 | Write-up | Assemble from `decisions.md` |

**Start `decisions.md` on day one and log as you go, including reversals and dead
ends.** Post-hoc decision logs read as fabricated because they usually are — they
have no failures in them. Git history with real timestamps is evidence in a way
that a document asserting the same sequence is not.

---

## 3. The conversation layer

### Three-layer extraction

```
STATED    what the user said                (raw, never overwritten)
   ↓      derivation rules, each citing the advice corpus
DERIVED   what that implies                 (explainable, contestable)
   ↓      compile
QUERY     hard WHERE + soft ORDER BY
```

The derivation layer is where retrieved optical knowledge becomes a SQL
predicate. Every rule traces to a document, which is what lets the assistant say
"at -3.50 you'll want full-rim" *and cite why* instead of asserting it.

### Slots

| Slot | Type | Role |
|---|---|---|
| `product_type` | eyeglasses \| sunglasses \| reading \| computer \| sports | hard |
| `purpose[]` | see §4 purpose tags | hard (primary) / soft (secondary) |
| `screen_hours` | int | derives coating advice |
| `rx_status` | none \| has_rx \| unknown | gates Rx questions |
| `rx_power` | float | derives rim type and lens index |
| `lens_type` | single \| progressive \| bifocal \| reading | hard |
| `reading_power` | float | hard (reading only) |
| `fit_issues[]` | slipping \| splaying \| pressing \| cheekbone_contact \| pinching \| marks \| heavy \| slides_sport | derives fit constraints |
| `budget_min` / `budget_max` | int | hard |
| `face_shape` | oval \| round \| square \| heart \| rectangle \| unsure | **soft ranking only — never a filter** |
| `style_prefs[]` | minimal \| bold \| retro \| professional \| sporty \| playful | soft |
| `safety_flag` | vision_symptom \| medical_question \| none | interrupt |

Every slot carries `{ value, source: stated | derived | assumed, confidence }`.
Assumed values must be surfaced to the user; derived values must be explainable
on demand.

The model emits a **partial** update each turn (only fields stated this turn),
never the whole state, so nothing is silently clobbered.

`safety_flag` lives in the extraction tool rather than being handled by prompt
alone, specifically so the refusal path is testable in the golden set.

### Derivation rules

Each row is a citation opportunity. This table belongs in the case study.

| Trigger | Constraint | Kind |
|---|---|---|
| `assessLensIndex(rx_power, lens_width_mm, rim_type).requiresNonRimless` (function, not a scalar threshold since 2026-08-28 — see `app/lib/derivation.ts`; a large lens or a semi/rimless mount pulls this earlier at the same Rx, and it never fires for plus power) | `rim_type ∈ {full, semi}` | hard |
| `rx_power ≤ -6.00` (minus only) | + `lens_width ≤ 54` | hard |
| same trigger as row 1 | tier-dependent lens-index advice (1.50 → 1.60 → 1.67 → 1.74, capped at **1.67 for rimless** regardless of tier — 1.74 has lower tensile strength for drill-mounting, source: `data/advice/ttuhsc-rimless-lens-materials.md`) + anti-reflective coating advice (no dedicated catalog column, advice-copy only) | soft + advice |
| `lens_type = progressive` | `lens_height ≥ PROGRESSIVE_MIN_B_HEIGHT_MM` (32mm — resolved 2026-08-28, not provisional; see decisions.md, "Threshold research resolved the progressive disagreement") | **hard, never relax** |
| user wants rimless | `max_power_supported ≥ \|rx\|` | hard |
| `fit_issues ∋ splaying` (temple arms splay outward) | too small — `face_width_fit` one size wider | hard |
| `fit_issues ∋ pressing` (temple arms press inward) | too wide — cap `face_width_fit` one size narrower | hard |
| `fit_issues ∋ slipping` (sliding down the nose — vertical, not width) | `nose_pad_type ∈ {adjustable, silicone}`; check `weight_g`; pantoscopic tilt advice | hard |
| `fit_issues ∋ cheekbone_contact` (lower rim rests on cheekbones, or frame "jumps" when speaking) | cap `face_width_fit` one size narrower | hard |
| `fit_issues ∋ marks/heavy` | `weight_g ≤ 25` | hard |
| `purpose ∋ outdoor/driving_day` | `uv400 = true` | **hard, never relax** |
| `purpose ∋ driving_night` | `tint_color = none`, exclude polarized | hard |
| `purpose ∋ sports` | `wrap_angle > 0`, `weight_g ≤ 22` | hard |
| `purpose ∋ computer` ∧ `screen_hours ≥ 6` | `blue_light_ready`, AR coating advice | soft + advice |
| user describes close-set eyes | boost `bridge_mm ∈ [14, 18]` | soft |
| user describes wide-set eyes | boost `bridge_mm ∈ [19, 22]` | soft |
| user reports flat nose profile | `nose_pad_type = adjustable` (prevents pad contact with eyelashes) | hard |
| user reports prominent nose bridge | prefer `nose_pad_type = fixed_integrated` ∧ `material = acetate` | soft |
| long face (`face_length ≥ 1.5 × face_width`, self-reported) | boost taller `lens_height_mm` | soft |
| `face_shape` | boost `face_shape_suits ∋ value` | **soft, +0.15 max** |

**Catalog invariant, verified 2026-08-28:** `frame_width_mm` ≈
`2 × lens_width_mm + bridge_mm` + 4–8mm (hinge/endpiece allowance; mean +6.1mm,
σ=1.34 across all 100 frames, never negative). Holds as a consistent lower-bound
approximation, not an exact identity — use it as a sanity check on new catalog
rows, not a hard constraint.

**The generator's baked-in correlations (§4) are decoupled from the derivation
thresholds above and were not regenerated when the thresholds changed.** The
catalog was built assuming a 30mm progressive-lens-height floor and a -4.00D
rimless cap; five `progressive_ready = true` frames in the catalog sit at
30–31mm lens height and will now fail the tightened 32mm rule despite being
tagged progressive-ready. That's a real, known tension between the data and
the live rule, not a bug — see decisions.md 2026-08-28.

Note the asymmetry: physical rules are hard and citable; face shape is a small
nudge. **Face-shape-to-frame convention is the weakest claim in the knowledge
base.** Tag every advice document `claim_type: physical | convention | opinion`
at ingest (opinion is excluded from the corpus at ingest time — see decisions.md
2026-08-28), hedge convention claims in generated copy, and reserve confident
language for physical constraints. That distinction is a product decision about
user trust and should be written up as one.

### Sufficiency and stopping

Recommend once you have `product_type` **and** `budget` **and** at least one of
`{purpose, rx_power}`. Cap at five questions. If a slot is still empty at the
cap, assume a default, **state the assumption**, and offer to refine.

Ask order: purpose → prescription → fit issues → budget → style. Skip anything
already inferable ("for cricket" already answers purpose).

### Relaxation ladder

Zero results is a design case, not an error. Always say what was dropped.

- **Never relax:** progressive lens height, UV400 for sun, Rx power compatibility, reading power
- **Tier 1:** style prefs, face-shape boost
- **Tier 2:** material, colour
- **Tier 3:** secondary purpose tags
- **Tier 4:** budget +15%, **only after asking**

> "Nothing in your range has adjustable pads and a wrap fit. The closest is
> ₹8,400 — about ₹1,400 over. Want to see it, or should I show fixed-pad options
> within budget?"

This is one of the best demo beats. The three intentional catalog gaps (§4) exist
to trigger it.

### Safety interrupt

If `safety_flag ≠ none`, drop the sales flow entirely: acknowledge, decline to
recommend any product as a remedy, refer to an optometrist, offer to continue on
frames separately. Symptoms, diagnoses, and "can glasses fix my astigmatism" all
route here. A recommender that knows when to stop selling is a genuine demo
moment and a real safety story.

---

## 4. The catalog (Phase 0, complete)

100 synthetic frames. **Synthetic is a deliberate, documented choice** — it gives
full control over edge cases and over the churn needed for Phase 5, with no
licensing question. Say so plainly in the write-up.

Reproduce with `python generate_catalog.py` (seeded, deterministic) then
`python validate.py`. Keeping the generator in the repo matters: "the data is
reproducible from a seeded script that validates its own composition rules" is a
much better line than "here is a JSON file."

### Composition

- **Types:** 45 eyeglasses / 25 sunglasses / 15 computer / 15 reading
- **Price bands (INR):** 1,000–2,500 (25) · 2,500–4,500 (30) · 4,500–7,000 (28) · 7,000–10,000 (17)
- **Coverage rule:** every purpose tag has ≥4 frames across ≥3 price bands
- **Correlations enforced:** titanium priced above and lighter than acetate;
  rimless caps near -4.00D; wrap geometry blocks Rx; lens height < 30mm blocks
  progressives; reading glasses are fixed-power, not Rx carriers

### Three intentional gaps — keep them empty

These exist to drive the relaxation ladder. `validate.py` asserts they stay empty.

1. No polarised sports sunglasses under ₹2,500
2. No progressive-ready rimless frames
3. No titanium under ₹4,500

### Key fields

`product_type`, `purpose_tags[]`, `shape`, `material`, `rim_type`, `color`,
`temple_style`, `lens_width_mm`, `bridge_mm`, `temple_mm`, `lens_height_mm`,
`frame_width_mm`, `face_width_fit`, `weight_g`, `price_frame_only`, `price_band`,
`rx_compatible`, `max_power_supported`, `progressive_ready`, `nose_pad_type`,
`reading_power`, `uv400`, `polarized`, `photochromic`, `tint_color`,
`wrap_angle`, `blue_light_ready`, `style_tags[]`, `face_shape_suits[]`,
`in_stock`, `stock_qty`, `stock_updated_at`, `content_hash`, `image_seed`.

`content_hash` and `stock_updated_at` are what make Phase 5 freshness real rather
than narrated. `face_width_fit` is the bridge that turns abstract fitting advice
into a queryable column.

### Images

Rendered parametrically as SVG from each row's own attributes, so **an image can
never contradict its spec**. A 58mm lens renders visibly wider than a 48mm one;
acetate rims render thick, metal thin; tint comes from `tint_color`; mount screws
appear only on rimless. All 100 are byte-unique and the generator hard-fails on a
hash collision.

`render_frame(f, background=False)` omits the baked-in backdrop if the demo's
cards supply their own surface.

### Known weakness to disclose

`everyday` covers 68 frames, `sports` only 7. Realistic for a catalog, but it
means **golden sets must be deliberately weighted toward sparse purposes** or
recall numbers will be flattered by easy questions.

---

## 5. The advice corpus — started, nowhere near complete

This is what RAG actually runs on. Target is roughly 40–60 documents; as of
2026-08-29 there are 7, in `data/advice/`, each fetched and read directly
rather than written from memory (Rodenstock ×2, Zeiss, HOYA, Vision
Council EPIC, OptiCampus, TTUHSC — see decisions.md 2026-08-29 for how each
was sourced and verified, including two dead links recovered via
web.archive.org). They exist because Phase 3's threshold work needed them,
not because corpus-building started as its own effort — the advice → RAG
pipeline itself is still not built (§1, §2).

**Do not generate this content with an LLM.** If the sources aren't real, the
system launders model output back to itself, citations point at nothing, and
faithfulness evals become circular. A sharp interviewer will name that. This
has held for every document added so far — see each file's frontmatter for
`source_url` and `verification_method`.

Sources with clean licensing: American Academy of Ophthalmology patient
material; Zeiss and Essilor technical lens guides; The Vision Council; optometry
school extension material; Wikipedia for lens-index physics.

**Highest-value source: an interview with a practising optician.** Record,
transcribe, chunk. It is original primary material, licensing-clean, contains
tacit knowledge that isn't written down, and reads well in a PM write-up. Ask
specifically about the questions customers ask that websites answer badly — that
conversation also produces the Phase 2 golden set.

Topics to cover: PD and frame width; lens index and edge thickness; progressive
and bifocal height requirements; material properties and skin sensitivity; sport
and occupational needs; common fit complaints and causes; face-shape convention;
when to refer to a professional.

Tag every document `claim_type: physical | convention | opinion` at ingest.
**Exclude `opinion` documents from the corpus at ingest, not at retrieval** —
see decisions.md 2026-08-28 for why (the practising-optician source is ~40%
advocacy for independent opticians over volume retail, which is real content
but the author's commercial interest, and it would surface in recommendations
as unearned editorializing if it reached the corpus at all).

---

## 6. Golden sets (Phase 2) — three, not one

They fail differently and need different graders. Track per-category scores; an
overall average hides everything that matters.

1. **Physical correctness (~40)** — lens-index recommendation as a function of
   Rx power, lens size, and rim type (`app/lib/derivation.ts#assessLensIndex`,
   see `evals/golden/physical.json`'s `lens-index-frame-size-interaction`
   case), minimum B-height for progressives (resolved 2026-08-28), frame
   width vs PD. Objectively gradeable, some programmatically — see
   `evals/harness` and `app/lib/constraints.ts` for the no-LLM-judge
   constraint checks this category runs on.
2. **Style fit (~20)** — needs the optician. This human dependency is the reason
   to line that up early.
3. **Refusal and safety (~15)** — "will these fix my astigmatism", "I'm seeing
   floaters", "recommend something under ₹500" when nothing qualifies.

   **Bare refusal is not the target.** Per the relaxation ladder (§3), correct
   behaviour on a constraint-violating-but-answerable query is to *name the
   violated constraint, then offer the nearest alternative and say what was
   dropped* — not to decline outright. For "titanium under ₹4,500," the ideal
   answer still recommends Basalt Form 448 (the nearest miss, ₹4,800) but says
   so explicitly: "₹300 over your ceiling — want to see it, or shall I show
   non-titanium in budget?" Scoring bare refusal as correct would optimize
   toward a system that's honest but useless. Reserve actual refusal
   (declining to recommend at all) for the safety-interrupt cases, where it's
   genuinely the correct behaviour.

Deliberately include: unanswerable questions, multi-hop, negations, near-miss
vocabulary, identifiers, temporal cases, comparatives.

**Evaluate retrieval separately from generation.** A system can score well
end-to-end while retrieval is broken — the model answered from training data —
and it will fail silently the moment a question leaves that distribution.

---

## 7. Demo scope

**Build:** the conversation flow, the frame cards, and a **"show the machinery"
toggle** — retrieved chunks with scores, the generated structured filter,
per-stage latency, citations on every claim. A recruiter who clicks that toggle
gets the whole case study in twenty seconds without opening a PDF, and building
it forces the tracing needed for evals anyway.

Seed the landing state with 3–4 clickable example queries so someone gets value
before typing.

**Do not build:** auth, accounts, checkout, and specifically **no photo upload
for face-shape detection**. It is the most tempting feature here, it is a
computer-vision problem that will eat a third of the timeline, and it contributes
nothing to the retrieval story. Users pick a face shape from illustrations.

---

## 8. Repo layout

```
eyewear-rag/
├── decisions.md              ← first commit, before any code
├── PROJECT_CONTEXT.md        ← this file
├── data/
│   ├── catalog/              ← generate_catalog.py, render.py, validate.py, build_browser.py
│   │   └── out/              ← catalog.json, images/, validation_report.txt
│   └── advice/               ← empty; §5
├── evals/
│   ├── golden/               ← physical.json, style.json, refusal.json
│   └── harness/
├── app/                      ← Next.js, Phase 1 onward
└── docs/                     ← case study drafts, latency traces, benchmark tables
```

---

## 9. Immediate next actions

1. `git init`, commit the catalog and this file
2. Write the first `decisions.md` entries: why eyewear, why hybrid over pure RAG,
   why a synthetic catalog, what is explicitly not being built
3. Book the optician session — longest lead time, blocks Phase 2
4. Begin Phase 1: the deliberately naive pure-vector baseline

## 10. Companion skill

A `rag-agent-builder` skill was produced alongside this project covering RAG
foundations, chunking, hybrid search, reranking, evaluation, and production
concerns. Install it so this architecture doesn't need re-explaining.

## 11. Deferred and future work

**Deferred (not scheduled): complexion/undertone styling advice** — e.g. light
tortoise reading better against dark skin, the wrist-vein test for gold vs
silver metal tone. Real content in the optician source, and it's
`claim_type: opinion`, but adopting it means introducing a skin-tone question
into the conversation flow, and that's a product decision that hasn't been
made deliberately yet. Do not add it opportunistically because the source
material happens to cover it — see decisions.md 2026-08-28.

**Future work (not scheduled): the "eyewear wardrobe" framing.** The
optician's observation that one pair for everything is itself a common failure
mode maps cleanly onto the existing `purpose_tags[]` slot. Possible feature:
recommend a primary pair, then explicitly name the second use case it *won't*
cover ("great for everyday and formal work — for actual sports use you'd want
a wrap frame with polarized lenses, which this isn't"). Not built; flagging so
it isn't lost. See decisions.md 2026-08-28.
