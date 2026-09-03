// Four-page restructure (decisions.md, 2026-09-03): this route moved to
// the product root earlier (2026-09-02); now split into a thin server
// wrapper (this file) and the interactive client component
// (ConversationDemo.tsx). The split exists for one reason: the eval
// one-liner at the bottom of the chat column needs real numbers read
// from the committed report JSON server-side, at request time -- a
// client component can't do a filesystem read, and hardcoding the
// numbers here would be exactly the thing this project's own "never
// hardcoded" rule forbids.
import ConversationDemo from "@/components/ConversationDemo";
import { loadEvalSummary } from "@/lib/eval-reports";

export default function Page() {
  const summary = loadEvalSummary();
  return (
    <ConversationDemo
      evalOneLiner={{
        groundednessMin: summary.groundedness.min,
        groundednessMax: summary.groundedness.max,
        conversationPass: summary.conversation?.pass ?? 0,
        conversationTotal: summary.conversation?.total ?? 0,
        gapPass: summary.gapHandling?.pass ?? 0,
        gapTotal: summary.gapHandling?.total ?? 0,
      }}
    />
  );
}
