# Eyewear RAG Recommender

Conversational eyewear recommender. Hybrid architecture: structured filters over
the frame catalog, RAG with citations over optician advice, one agent
orchestrating both.

**Live demo:** [rag-eyewear.vercel.app](https://rag-eyewear.vercel.app/) —
the conversational interface with the full machinery panel, at the root.
The deliberately-naive Phase 1 baseline it's measured against is kept
reachable at [`/baseline`](https://rag-eyewear.vercel.app/baseline), not
competing for the root URL.

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
similarity. See `docs/phase3-hybrid-ab.md` for the results.

## Run the Phase 4 advice/RAG pipeline

```bash
cd app
npm run advice-chunks              # -> ../data/advice/out/chunks.json
npm run embed-advice               # -> ../data/advice/out/embeddings.json
npm run validate-judges            # LLM judges vs. hand-labelled examples
npm run eval -- --pipeline=both    # naive vs. hybrid vs. orchestrated
```

Advice corpus (documents only, never the catalog) chunked and embedded;
`orchestrated` pipeline combines Phase 3's SQL frame selection with RAG
over advice, cited and hedged by `claim_type`. Three LLM judges
(groundedness, citation accuracy, hedging-match) grade properties of prose
`app/lib/constraints.ts` can't — see `docs/phase4-advice-rag.md`.

## Status

Phase 0 (data) and Phase 1 (naive baseline) complete. Phase 2 (eval
harness) started — constraint-violation checks are in; refusal-and-safety
golden set has ~19 cases across four categories (`evals/golden/refusal.json`);
physical.json has 7 seed cases plus a frame-size lens-index case;
style.json not started. Phase 3 complete — catalog → SQL half built and
A/B'd against Phase 1. Phase 4 complete — advice → RAG built and
orchestrated with the SQL half in one pipeline, evaluated with validated
LLM judges; `data/advice/` still has only 6 documents (nowhere near the
~40–60 target) and no `convention`-tagged source yet — see PROJECT_CONTEXT
§2, §5, §6.
