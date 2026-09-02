"use client";

// Turn-0 face-shape opener (PROJECT_CONTEXT.md §3/§7, moved here 2026-09-01
// decisions.md): tappable illustrations, "not sure" always available, a
// soft ranking nudge and never a filter -- selecting one sends a plain
// sentence through the same extraction path as any other reply, so
// face_shape gets the identical {value, source: stated, confidence}
// treatment as everything else typed in the box, no special-cased slot.
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
    <div className="flex gap-2.5 mt-4 flex-wrap">
      {SHAPES.map((s) => {
        const isSelected = selected === s.label;
        return (
          <button
            key={s.label}
            onClick={() => onSelect(s.label)}
            disabled={disabled}
            aria-pressed={isSelected}
            className="rounded-lg bg-[#FDFEFD] px-3 pt-2.5 pb-2 flex flex-col items-center gap-1.5 disabled:opacity-50 transition-shadow hover:shadow-[0_2px_8px_rgba(20,32,28,0.1)]"
            style={{
              border: `1.5px solid ${isSelected ? "#14493E" : "#B9CAC1"}`,
              boxShadow: isSelected ? "0 0 0 1px #14493E, 0 2px 8px rgba(20,73,62,0.15)" : "0 1px 3px rgba(20,32,28,0.07)",
            }}
          >
            <svg viewBox="0 0 70 86" width="40" height="48" aria-hidden="true">
              <path
                d={s.d}
                fill={isSelected ? "#E7F0EC" : "#E7EDEA"}
                stroke={isSelected ? "#14493E" : "#7C9188"}
                strokeWidth="2"
              />
              <circle cx="26" cy="36" r="2.4" fill={isSelected ? "#14493E" : "#4A5B53"} />
              <circle cx="44" cy="36" r="2.4" fill={isSelected ? "#14493E" : "#4A5B53"} />
            </svg>
            <span className="text-[11.5px] font-medium" style={{ color: isSelected ? "#14493E" : "#14201C" }}>
              {s.label}
            </span>
          </button>
        );
      })}
      <button
        onClick={() => onSelect("Not sure")}
        disabled={disabled}
        aria-pressed={selected === "Not sure"}
        className="rounded-lg bg-[#FDFEFD] px-3 flex flex-col items-center justify-center gap-1.5 disabled:opacity-50 transition-shadow hover:shadow-[0_2px_8px_rgba(20,32,28,0.1)]"
        style={{
          border: `1.5px solid ${selected === "Not sure" ? "#14493E" : "#B9CAC1"}`,
          boxShadow: selected === "Not sure" ? "0 0 0 1px #14493E, 0 2px 8px rgba(20,73,62,0.15)" : "0 1px 3px rgba(20,32,28,0.07)",
          minWidth: 58,
        }}
      >
        <span className="text-[17px] font-medium" style={{ color: selected === "Not sure" ? "#14493E" : "#4A5B53" }}>?</span>
        <span className="text-[11.5px] font-medium" style={{ color: selected === "Not sure" ? "#14493E" : "#14201C" }}>
          Not sure
        </span>
      </button>
    </div>
  );
}
