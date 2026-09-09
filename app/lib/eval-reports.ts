// /evals + /'s one-liner (decisions.md, 2026-09-03): reads the committed
// report JSON directly at request time -- server-only, never imported from
// a "use client" file -- so both pages stay current when evals are
// re-run instead of quoting a hand-typed number. Reports/golden files are
// mirrored into app/data/ by scripts/copy-runtime-data.ts (predev/prebuild)
// for the same Vercel-tracing reason app/lib/catalog-db.ts's data is.
import fs from "node:fs";
import path from "node:path";

const REPORTS_DIR = path.resolve(process.cwd(), "data", "eval-reports");
const GOLDEN_DIR = path.resolve(process.cwd(), "data", "eval-golden");

interface JudgeDimensionSummary {
  total: number;
  agree: number;
  disagreements: { id: string; hand: string; judge: string; reasoning: string }[];
}
interface JudgeCase {
  id: string;
  source: string;
  [dimension: string]: unknown;
}
interface JudgeReport {
  generatedAt: string;
  summary: Record<string, JudgeDimensionSummary>;
  cases: JudgeCase[];
}
interface ConversationReport {
  generatedAt: string;
  summary: { totalPass: number; totalChecks: number };
  cases: { id: string; checks: { label: string; pass: boolean; detail: string }[]; skipped?: boolean }[];
}
interface GapReport {
  generatedAt: string;
  summary: { pass: number; total: number };
  cases: { label: string; ok: boolean; exactMatchCount: number; isRealGap: boolean; offersNamedAlternative: boolean; nearestAlternative?: { frame: string; droppedClause: string } }[];
}

function listFiles(prefix: string): string[] {
  if (!fs.existsSync(REPORTS_DIR)) return [];
  return fs
    .readdirSync(REPORTS_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .sort(); // timestamp is embedded in the filename (ISO-derived), so lexical sort is chronological
}

function readReport<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, file), "utf-8")) as T;
}

function readGolden<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, file), "utf-8")) as T;
}

interface DimensionRange {
  min: number;
  max: number;
  runs: { generatedAt: string; agree: number; total: number; pct: number }[];
}

function dimensionRange(reports: JudgeReport[], dim: string): DimensionRange {
  const runs = reports
    .map((r) => r.summary[dim])
    .filter((s): s is JudgeDimensionSummary => Boolean(s) && s.total > 0)
    .map((s, i) => ({ generatedAt: reports[i].generatedAt, agree: s.agree, total: s.total, pct: Math.round((s.agree / s.total) * 100) }));
  const pcts = runs.map((r) => r.pct);
  return { min: pcts.length ? Math.min(...pcts) : 0, max: pcts.length ? Math.max(...pcts) : 0, runs };
}

export interface EvalSummary {
  latestGeneratedAt: string;
  judgeRunsUsed: number;
  judgeCaseTotal: number;
  groundedness: DimensionRange;
  citationAccuracy: DimensionRange;
  hedgingMatch: DimensionRange;
  latestJudgeReport: JudgeReport | null;
  conversation: { pass: number; total: number; caseCount: number; generatedAt: string } | null;
  gapHandling: { pass: number; total: number; generatedAt: string; cases: GapReport["cases"] } | null;
}

/** The last N (3, matching this project's established "run three times" pattern) judge-validation reports, oldest first -- used to compute the honest min-max range shown on both the demo one-liner and /evals, never a single cherry-picked run. */
const JUDGE_RUNS_FOR_RANGE = 3;

export function loadEvalSummary(): EvalSummary {
  const judgeFiles = listFiles("judge-validation-").slice(-JUDGE_RUNS_FOR_RANGE);
  const judgeReports = judgeFiles.map((f) => readReport<JudgeReport>(f));

  const conversationFiles = listFiles("conversation-eval-");
  const latestConversation = conversationFiles.length > 0 ? readReport<ConversationReport>(conversationFiles[conversationFiles.length - 1]) : null;

  const gapFiles = listFiles("gap-handling-");
  const latestGap = gapFiles.length > 0 ? readReport<GapReport>(gapFiles[gapFiles.length - 1]) : null;

  const latestJudgeReport = judgeReports.length > 0 ? judgeReports[judgeReports.length - 1] : null;

  const allGeneratedAt = [
    ...judgeReports.map((r) => r.generatedAt),
    ...(latestConversation ? [latestConversation.generatedAt] : []),
    ...(latestGap ? [latestGap.generatedAt] : []),
  ].sort();

  let judgeCaseTotal = 0;
  try {
    const golden = readGolden<{ cases: unknown[] }>("judge_validation.json");
    judgeCaseTotal = golden.cases.length;
  } catch {
    judgeCaseTotal = 0;
  }

  return {
    latestGeneratedAt: allGeneratedAt.length > 0 ? allGeneratedAt[allGeneratedAt.length - 1] : "",
    judgeRunsUsed: judgeReports.length,
    judgeCaseTotal,
    groundedness: dimensionRange(judgeReports, "groundedness"),
    citationAccuracy: dimensionRange(judgeReports, "citation_accuracy"),
    hedgingMatch: dimensionRange(judgeReports, "hedging_match"),
    latestJudgeReport,
    conversation: latestConversation
      ? {
          pass: latestConversation.summary.totalPass,
          total: latestConversation.summary.totalChecks,
          caseCount: latestConversation.cases.filter((c) => !c.skipped).length,
          generatedAt: latestConversation.generatedAt,
        }
      : null,
    gapHandling: latestGap
      ? { pass: latestGap.summary.pass, total: latestGap.summary.total, generatedAt: latestGap.generatedAt, cases: latestGap.cases }
      : null,
  };
}

export interface CaseMatrixRow {
  id: string;
  source: string;
  /** The real generated (or hand-constructed) answer text this case grades -- lets a page quote
      the actual sentence being judged instead of paraphrasing it. */
  answer: string;
  /** The hand-labeller's own reasoning for this case, straight from judge_validation.json -- real,
      committed text, never generated for display, since it already exists and already IS the "why
      does this case matter" answer. */
  labelReasoning: string;
  dimensions: Partial<
    Record<"groundedness" | "citation_accuracy" | "hedging_match", { hand: string; judge: string; agrees: boolean; judgeReasoning: string }>
  >;
}

/** /evals' interactive case matrix (decisions.md, 2026-09-09): merges judge_validation.json's
    real hand-authored cases with the LATEST judge report's real per-dimension verdicts -- the
    prototype this was built against hand-typed 18 rows to demonstrate this UI pattern; here the
    same 18 rows are the actual committed test data, so the matrix can never silently drift from
    what a fresh `npm run validate-judges` would show. */
export function loadCaseMatrix(): CaseMatrixRow[] {
  let goldenCases: { id: string; source: string; answer: string; label_reasoning: string }[] = [];
  try {
    const golden = readGolden<{ cases: { id: string; source: string; answer: string; label_reasoning: string }[] }>("judge_validation.json");
    goldenCases = golden.cases;
  } catch {
    goldenCases = [];
  }

  const judgeFiles = listFiles("judge-validation-");
  const latestJudge = judgeFiles.length > 0 ? readReport<JudgeReport>(judgeFiles[judgeFiles.length - 1]) : null;
  const judgeById = new Map((latestJudge?.cases ?? []).map((c) => [c.id, c]));

  return goldenCases.map((gc) => {
    const jc = judgeById.get(gc.id);
    const dims: CaseMatrixRow["dimensions"] = {};
    (["groundedness", "citation_accuracy", "hedging_match"] as const).forEach((dim) => {
      const d = jc?.[dim] as { hand: string; judge: string; agrees: boolean; reasoning: string } | undefined;
      if (d) dims[dim] = { hand: d.hand, judge: d.judge, agrees: d.agrees, judgeReasoning: d.reasoning };
    });
    return { id: gc.id, source: gc.source, answer: gc.answer, labelReasoning: gc.label_reasoning, dimensions: dims };
  });
}

export function loadGoldenCaseCounts() {
  function safeCount(file: string): number {
    try {
      const g = readGolden<{ cases: unknown[] }>(file);
      return g.cases.length;
    } catch {
      return 0;
    }
  }
  function safeCategoryCounts(file: string): Record<string, number> {
    try {
      const g = readGolden<Record<string, unknown>>(file);
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(g)) if (Array.isArray(v)) out[k] = v.length;
      return out;
    } catch {
      return {};
    }
  }
  return {
    conversation: safeCount("conversation.json"),
    judgeValidation: safeCount("judge_validation.json"),
    refusal: safeCategoryCounts("refusal.json"),
    physical: safeCategoryCounts("physical.json"),
  };
}
