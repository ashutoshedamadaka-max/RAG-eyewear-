// Deployment readiness (decisions.md, 2026-09-02). A coarse, best-effort
// per-IP cap on the two routes that call OpenAI -- "every visitor costs
// real money on my key" is a real constraint for a portfolio demo with no
// auth wall. In-memory, per-lambda-instance only: this is NOT a
// distributed rate limiter (that needs Upstash/Vercel KV/similar, real
// infra this demo's traffic doesn't justify -- the same judgment call this
// project has made repeatedly about infra scale, e.g. no vector DB for 100
// rows, decisions.md 2026-08-27). Consequence, stated plainly rather than
// left implicit: the count resets on cold start and is not shared across
// concurrent instances, so this is a soft ceiling that stops a runaway
// script or a repeated refresh, not a hard guarantee against a determined,
// distributed abuser -- that would need real infra this project has no
// standing reason to add.
interface Bucket {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_PER_WINDOW = Number(process.env.RATE_LIMIT_PER_HOUR ?? 30);
const PRUNE_THRESHOLD = 5000;

const buckets = new Map<string, Bucket>();

export function clientIdFor(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return "unknown";
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
}

function pruneExpired(now: number) {
  if (buckets.size < PRUNE_THRESHOLD) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= WINDOW_MS) buckets.delete(key);
  }
}

export function checkRateLimit(id: string): RateLimitResult {
  const now = Date.now();
  pruneExpired(now);

  const bucket = buckets.get(id);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(id, { count: 1, windowStart: now });
    return { allowed: true, remaining: MAX_PER_WINDOW - 1 };
  }

  if (bucket.count >= MAX_PER_WINDOW) {
    return { allowed: false, remaining: 0, retryAfterMs: WINDOW_MS - (now - bucket.windowStart) };
  }

  bucket.count += 1;
  return { allowed: true, remaining: MAX_PER_WINDOW - bucket.count };
}
