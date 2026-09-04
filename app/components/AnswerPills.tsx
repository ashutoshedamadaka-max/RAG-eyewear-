"use client";

import { useState } from "react";
import { composeToggleMessage, type TopicPillConfig } from "@/components/pill-options";

// Answer pills (decisions.md, 2026-09-04): a shortcut alongside the text
// input, never a replacement for it -- clicking a pill (or hitting
// Continue on a multi-select group) calls the exact same `onSubmit`
// callback the input form calls, so the composed message goes through
// the identical extraction pipeline and the transcript reads identically
// either way. Nothing here talks to slots directly. Restyled 2026-09-04
// to match the prototype's `.pill` -- theme tokens, a filled accent pill
// when selected rather than a bordered one, no shadow.
function PillButton({
  label,
  selected,
  onClick,
  disabled,
}: {
  label: string;
  selected?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className="rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        borderColor: selected ? "var(--acc)" : "var(--line)",
        background: selected ? "var(--acc)" : "var(--block)",
        color: selected ? "#fff" : "var(--ink2)",
      }}
    >
      {label}
    </button>
  );
}

export default function AnswerPills({
  topic,
  config,
  onSubmit,
  disabled,
}: {
  topic: string;
  config: TopicPillConfig;
  onSubmit: (message: string) => void;
  disabled?: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  // Keyed by group index -> set of selected option ids, toggle groups only.
  const [selectedByGroup, setSelectedByGroup] = useState<Record<number, Set<string>>>({});

  if (dismissed) return null;

  function toggle(groupIndex: number, optionId: string) {
    setSelectedByGroup((prev) => {
      const current = new Set(prev[groupIndex] ?? []);
      if (current.has(optionId)) current.delete(optionId);
      else current.add(optionId);
      return { ...prev, [groupIndex]: current };
    });
  }

  const hasToggleSelection = Object.values(selectedByGroup).some((s) => s.size > 0);

  function submitToggled() {
    const phrases: string[] = [];
    config.groups.forEach((group, i) => {
      if (group.mode !== "toggle") return;
      const selected = selectedByGroup[i];
      if (!selected) return;
      for (const opt of group.options) {
        if (selected.has(opt.id)) phrases.push(opt.phrase);
      }
    });
    if (phrases.length === 0) return;
    onSubmit(composeToggleMessage(topic, phrases));
  }

  return (
    <div className="mt-3 flex flex-col gap-2.5">
      {config.groups.map((group, groupIndex) => (
        <div key={groupIndex} className="flex gap-2 flex-wrap">
          {group.options.map((opt) => (
            <PillButton
              key={opt.id}
              label={opt.label}
              disabled={disabled}
              selected={group.mode === "toggle" ? (selectedByGroup[groupIndex]?.has(opt.id) ?? false) : false}
              onClick={() => (group.mode === "toggle" ? toggle(groupIndex, opt.id) : onSubmit(opt.phrase))}
            />
          ))}
        </div>
      ))}
      <div className="flex items-center gap-2.5 flex-wrap">
        {hasToggleSelection && (
          <button
            type="button"
            onClick={submitToggled}
            disabled={disabled}
            className="rounded-full bg-[var(--ink)] text-[var(--shell)] px-3.5 py-1.5 text-[12.5px] font-medium disabled:opacity-50"
          >
            Continue
          </button>
        )}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          disabled={disabled}
          className="text-[12px] font-medium text-[var(--ink3)] underline disabled:opacity-50"
        >
          Something else
        </button>
      </div>
    </div>
  );
}
