# Eyewear RAG Recommender

Conversational eyewear recommender. Hybrid architecture: structured filters over
the frame catalog, RAG with citations over optician advice, one agent
orchestrating both.

Start with `PROJECT_CONTEXT.md`. Append to `decisions.md` as you go.

## Reproduce the catalog

```bash
cd data/catalog
python generate_catalog.py     # -> out/catalog.json + out/images/*.svg (seeded)
python validate.py             # composition rules, correlations, intentional gaps
python build_browser.py        # -> out/catalog_browser.html
```

Deterministic. `validate.py` must report 0 failures.

## Run the Phase 1 naive baseline

```bash
cd app
npm install
cp .env.local.example .env.local   # add your OPENAI_API_KEY
npm run blurbs                     # -> ../data/catalog/out/blurbs.json
npm run embed                      # -> ../data/catalog/out/embeddings.json
npm run dev                        # http://localhost:3000
```

Pure vector RAG over the catalog — no SQL filtering, no reranking. Built
to fail on constraint queries; see `docs/phase1-baseline-failures.md` for
the captured failures.

## Run the Phase 2 harness

```bash
cd app
npm run eval -- --pipeline=naive   # -> ../evals/harness/reports/naive-*.json
```

Runs the golden query cases (`evals/golden/physical.json`) through a
pipeline and checks retrieved/recommended frames against hard constraints
by direct field comparison — no LLM judge. Also checks the two contested
thresholds in `app/lib/config/thresholds.ts` against the catalog directly.

## Run the Phase 3 hybrid A/B

```bash
cd app
npm run build-catalog-db           # -> ../data/catalog/out/catalog.db
npm run eval -- --pipeline=both    # naive vs. hybrid, side by side
```

Catalog queries route to real SQL (`node:sqlite`) instead of vector
similarity. See `docs/phase3-hybrid-ab.md` for the results — the advice →
RAG half isn't built yet, though `data/advice/` now has 7 documents from
verified primary sources (§5) rather than being empty.

## Status

Phase 0 (data) and Phase 1 (naive baseline) complete. Phase 2 (eval
harness) started — constraint-violation checks are in; refusal-and-safety
golden set seeded at ~15 cases (`evals/golden/refusal.json`); physical.json
has 7 seed cases plus a frame-size lens-index case; style.json not started.
Phase 3 started — catalog → SQL half built and A/B'd against Phase 1;
advice → RAG pipeline not built, but `data/advice/` has 7 sourced
documents (nowhere near the ~40–60 target) — see PROJECT_CONTEXT §2, §5, §6.
