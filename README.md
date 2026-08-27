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

## Status

Phase 0 (data) and Phase 1 (naive baseline) complete. Phase 2 (eval
harness + golden sets) is next — see PROJECT_CONTEXT §2.
