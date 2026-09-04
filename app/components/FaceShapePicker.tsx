"use client";

// Turn-0 face-shape opener (PROJECT_CONTEXT.md §3/§7, moved here 2026-09-01
// decisions.md): tappable illustrations, "not sure" always available, a
// soft ranking nudge and never a filter -- selecting one sends a plain
// sentence through the same extraction path as any other reply, so
// face_shape gets the identical {value, source: stated, confidence}
// treatment as everything else typed in the box, no special-cased slot.
// Restyled 2026-09-04 to theme tokens (CSS variables, globals.css) so it
// re-themes with the rest of the app instead of a fixed light palette.
const SHAPES: { label: string; d: string }[] = [
  { label: "Oval", d: "M35 8C50 8 58 24 58 40 58 60 48 74 35 74 22 74 12 60 12 40 12 24 20 8 35 8Z" },
  { label: "Round", d: "M35 8C51 8 60 22 60 40 60 58 51 74 35 74 19 74 10 58 10 40 10 22 19 8 35 8Z" },
  { label: "Square", d: "M14 12H56C58 12 58 14 58 16L57 52C56 68 47 76 35 76 23 76 14 68 13 52L12 16C12 14 12 12 14 12Z" },
  { label: "Heart", d: "M12 16C20 10 50 10 58 16L55 44C53 62 46 76 35 76 24 76 17 62 15 44Z" },
  { label: "Rectangle", d: "M15 10H55L54 56C53 70 46 78 35 78 24 78 17 70 16 56Z" },
];

export default function FaceShapePicker({
  selected,
  onSelect,
  disabled,
}: {
  selected?: string;
  onSelect: (label: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-2 mt-4 flex-wrap">
      {SHAPES.map((s) => {
        const isSelected = selected === s.label;
        return (
          <button
            key={s.label}
            onClick={() => onSelect(s.label)}
            disabled={disabled}
            aria-pressed={isSelected}
            className="rounded-[12px] border px-3 pt-2.5 pb-2 flex flex-col items-center gap-1 disabled:opacity-50 transition-colors"
            style={{
              borderColor: isSelected ? "var(--acc)" : "var(--line)",
              background: isSelected ? "var(--acc-lt)" : "var(--block)",
            }}
          >
            <svg viewBox="0 0 70 86" width="36" height="45" aria-hidden="true">
              <path
                d={s.d}
                fill={isSelected ? "var(--acc-lt)" : "var(--sunk)"}
                stroke={isSelected ? "var(--acc)" : "var(--line)"}
                strokeWidth="1.8"
              />
              <circle cx="26" cy="36" r="2" fill={isSelected ? "var(--acc)" : "var(--ink3)"} />
              <circle cx="44" cy="36" r="2" fill={isSelected ? "var(--acc)" : "var(--ink3)"} />
            </svg>
            <span className="text-[11.5px] font-medium" style={{ color: isSelected ? "var(--acc)" : "var(--ink2)" }}>
              {s.label}
            </span>
          </button>
        );
      })}
      <button
        onClick={() => onSelect("Not sure")}
        disabled={disabled}
        aria-pressed={selected === "Not sure"}
        className="rounded-[12px] border px-3 flex flex-col items-center justify-center gap-1 disabled:opacity-50 transition-colors"
        style={{
          borderColor: selected === "Not sure" ? "var(--acc)" : "var(--line)",
          background: selected === "Not sure" ? "var(--acc-lt)" : "var(--block)",
          minWidth: 58,
        }}
      >
        <svg viewBox="0 0 70 86" width="36" height="45" aria-hidden="true">
          <path d="M35 14v58M14 43h42" stroke="var(--line)" strokeWidth="2" />
        </svg>
        <span className="text-[11.5px] font-medium" style={{ color: selected === "Not sure" ? "var(--acc)" : "var(--ink2)" }}>
          Not sure
        </span>
      </button>
    </div>
  );
}
