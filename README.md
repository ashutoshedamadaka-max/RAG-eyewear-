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

## Status

Phase 0 (data) complete. Phase 1 (naive baseline) is next — see PROJECT_CONTEXT §2.
