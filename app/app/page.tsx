"use client";

import { useState } from "react";

interface RetrievedFrame {
  frame_id: string;
  score: number;
  brand: string;
  model: string;
  material: string;
  price_frame_only: number;
  currency: string;
  in_stock: boolean;
  stock_qty: number;
  text: string;
}

interface QueryResult {
  query: string;
  answer: string;
  retrieved: RetrievedFrame[];
}

const EXAMPLE_QUERIES = [
  "Titanium frames under ₹8,000, in stock",
  "Polarized sports sunglasses under ₹2,500",
  "Progressive-ready rimless frames",
  "Titanium frames under ₹4,500",
];

export default function Home() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runQuery(q: string) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-50">
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">
          Phase 1 &mdash; Naive Pure-Vector RAG Baseline
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Every catalog frame is embedded as a flattened prose blurb. A query is
          embedded with the same model, matched by cosine similarity against all
          100 frames, and the top 5 are handed to an LLM as context &mdash; no SQL
          filtering, no metadata constraints, no reranking. This is deliberately
          the naive baseline: watch it fail on numeric and stock constraints.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {EXAMPLE_QUERIES.map((q) => (
            <button
              key={q}
              onClick={() => {
                setQuery(q);
                runQuery(q);
              }}
              className="rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              {q}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) runQuery(query.trim());
          }}
          className="mt-4 flex gap-2"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. titanium frames under ₹8,000, in stock"
            className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-zinc-900 dark:bg-zinc-50 text-white dark:text-black px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Searching..." : "Ask"}
          </button>
        </form>

        {error && (
          <p className="mt-6 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {result && (
          <div className="mt-8 space-y-6">
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                Answer
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                {result.answer}
              </p>
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                Retrieved chunks (show the machinery)
              </h2>
              <div className="mt-2 space-y-2">
                {result.retrieved.map((hit, i) => (
                  <div
                    key={hit.frame_id}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="text-zinc-400">[{i + 1}]</span>
                      <span>
                        {hit.brand} {hit.model}
                      </span>
                      <span className="text-zinc-400">&middot;</span>
                      <span>score {hit.score.toFixed(3)}</span>
                      <span className="text-zinc-400">&middot;</span>
                      <span>{hit.material}</span>
                      <span className="text-zinc-400">&middot;</span>
                      <span>
                        {hit.currency} {hit.price_frame_only}
                      </span>
                      <span className="text-zinc-400">&middot;</span>
                      <span
                        className={
                          hit.in_stock
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }
                      >
                        {hit.in_stock ? `in stock (${hit.stock_qty})` : "out of stock"}
                      </span>
                    </div>
                    <p className="mt-1 text-zinc-600 dark:text-zinc-400">{hit.text}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
