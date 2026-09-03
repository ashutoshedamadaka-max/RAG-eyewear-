import Link from "next/link";

// Architecture page (decisions.md, 2026-09-03). Static prose + a real,
// working CSS diagram of the actual pipeline shape -- not a placeholder
// box -- built while a fuller supplied diagram is still pending; this one
// is real (matches MachineryPanel's six stages exactly) and can sit
// alongside or be replaced by whatever's supplied later, not thrown away
// meanwhile.
function StageBox({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex-1 min-w-[150px] border border-[#DFE6E2] bg-[#FDFEFD] rounded-md p-3.5">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="w-5 h-5 rounded-full bg-[#14201C] text-white text-[10.5px] leading-[20px] text-center flex-none tabular-nums">{n}</div>
        <div className="text-[13px] font-medium text-[#14201C]">{title}</div>
      </div>
      <p className="text-[11.5px] leading-relaxed text-[#5F6F68] m-0">{children}</p>
    </div>
  );
}

function Arrow() {
  return <div className="hidden min-[860px]:flex items-center text-[#8A9992] text-[18px] px-1">→</div>;
}

export default function HowItWorksPage() {
  return (
    <div className="min-h-full bg-[#F6F8F7]">
      <div className="max-w-[820px] mx-auto px-6 py-10">
        <h1
          className="text-[26px] leading-tight text-[#14201C] tracking-tight m-0"
          style={{ fontFamily: "var(--font-serif, inherit)", fontWeight: 600 }}
        >
          How it works
        </h1>
        <p className="text-[13.5px] leading-relaxed text-[#5F6F68] mt-2 max-w-[64ch]">
          The short version: the catalogue is a database, not a corpus. Prices, stock, and
          dimensions are exact, checkable facts — they belong in SQL, where a query either
          matches or it doesn&apos;t. Optical guidance is different: it&apos;s prose, best matched by
          meaning, not exact fields. One system, two different jobs, one agent orchestrating both.
        </p>

        <section className="mt-9">
          <h2 className="text-[16px] font-semibold text-[#14201C] m-0 mb-2.5">
            Why the catalogue doesn&apos;t go through RAG
          </h2>
          <p className="text-[13.5px] leading-relaxed text-[#5F6F68] max-w-[64ch]">
            Embedding product rows and doing similarity search is the standard failure mode of AI
            recommender demos: it returns items that are semantically <em>close</em> to the query,
            not items that actually satisfy it. &ldquo;Titanium frames under ₹4,500&rdquo; and &ldquo;titanium
            frames around ₹4,800&rdquo; read as nearly identical vectors — but one is in budget and one
            isn&apos;t, and a customer doesn&apos;t care how close the embedding was. This project builds that
            failure on purpose first: the{" "}
            <Link href="/baseline" className="underline text-[#14493E] font-medium">
              naive Phase 1 baseline
            </Link>{" "}
            is pure vector RAG over the same catalogue, kept live specifically so the gap is a real
            A/B, not a claim.
          </p>
          <p className="text-[13.5px] leading-relaxed text-[#5F6F68] mt-3 max-w-[64ch]">
            The fix isn&apos;t a better embedding model — it&apos;s recognizing that price, stock, material,
            and every dimension in the catalogue are <em>structured</em> facts a database already
            handles exactly. They go through a compiled SQL filter instead: a constraint either
            holds or it doesn&apos;t, with no similarity score standing in for a real answer.
          </p>
        </section>

        <section className="mt-9">
          <h2 className="text-[16px] font-semibold text-[#14201C] m-0 mb-3">The six-stage pipeline</h2>
          <p className="text-[13.5px] leading-relaxed text-[#5F6F68] mb-4 max-w-[64ch]">
            Every real recommendation turn goes through six stages, in this order — the same six
            the live machinery panel on the{" "}
            <Link href="/" className="underline text-[#14493E] font-medium">
              demo
            </Link>{" "}
            traces in real time, not a simplified summary of it.
          </p>
          <div className="flex flex-wrap min-[860px]:flex-nowrap items-stretch gap-2.5">
            <StageBox n={1} title="Read the conversation">
              One LLM call extracts what THIS turn added to slot state — a partial update, never a
              re-derivation of the whole conversation.
            </StageBox>
            <Arrow />
            <StageBox n={2} title="Applied the fitting rules">
              Derivation rules run against the cumulative slots — some hard (progressive lens
              height, UV400), some soft ranking nudges (style, face shape).
            </StageBox>
            <Arrow />
            <StageBox n={3} title="Queried the catalogue">
              The compiled filter runs as real SQL against the frame database. A relaxation ladder
              engages only if the exact query returns nothing, one constraint at a time.
            </StageBox>
          </div>
          <div className="flex flex-wrap min-[860px]:flex-nowrap items-stretch gap-2.5 mt-2.5">
            <StageBox n={4} title="Retrieved optician guidance">
              The same turn is embedded and matched against the advice corpus — chunks tagged
              physical or convention, below a similarity floor dropped before the model sees them.
            </StageBox>
            <Arrow />
            <StageBox n={5} title="Wrote the answer">
              Generation runs against both retrieved halves at once — cards carry the catalogue
              facts, prose carries judgement, citations map every claim back to its source.
            </StageBox>
            <Arrow />
            <StageBox n={6} title="What it cost">
              Real token counts and timings from the actual API responses this turn made — never
              estimated, labelled where the underlying rate genuinely is.
            </StageBox>
          </div>
        </section>

        <section className="mt-9">
          <h2 className="text-[16px] font-semibold text-[#14201C] m-0 mb-2.5">
            The split: structured filters vs. retrieval
          </h2>
          <p className="text-[13.5px] leading-relaxed text-[#5F6F68] max-w-[64ch]">
            Stage 3 and stage 4 are deliberately two different mechanisms, not two configurations
            of the same one. The catalogue is never embedded at all — <code className="text-[12.5px] bg-[#EEF2F0] px-1 py-0.5 rounded">app/lib/catalog-db.ts</code>{" "}
            queries live SQL. The advice corpus is exactly what RAG is actually good at: unstructured
            optical guidance, matched by meaning, where the right chunk isn&apos;t knowable in advance
            from a fixed schema.
          </p>
          <p className="text-[13.5px] leading-relaxed text-[#5F6F68] mt-3 max-w-[64ch]">
            One more split inside the advice half matters just as much: every retrieved chunk
            carries a <code className="text-[12.5px] bg-[#EEF2F0] px-1 py-0.5 rounded">claim_type</code> — <b className="text-[#14201C] font-medium">physical</b>{" "}
            (a measurable fact, stated plainly) or <b className="text-[#14201C] font-medium">convention</b>{" "}
            (a styling norm, true by custom, always hedged and named as one). The system prompt
            enforces this at generation time, and it&apos;s one of the things the{" "}
            <Link href="/evals" className="underline text-[#14493E] font-medium">
              evaluation report
            </Link>{" "}
            grades directly, not just describes.
          </p>
        </section>

        <div className="mt-10 pt-5 border-t border-[#DFE6E2] flex gap-4 flex-wrap text-[13px]">
          <Link href="/" className="underline text-[#14493E] font-medium">
            ← Try the live demo
          </Link>
          <Link href="/evals" className="underline text-[#14493E] font-medium">
            Read the evaluation report
          </Link>
        </div>
      </div>
    </div>
  );
}
