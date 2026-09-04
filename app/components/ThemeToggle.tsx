"use client";

import { useEffect, useState } from "react";

// Light/dark toggle (decisions.md, 2026-09-04). The actual theme is applied
// instantly, before hydration, by the inline script in layout.tsx (reads
// localStorage, sets `data-theme` on <html>) -- this component only owns
// which button reads as pressed and persists a future choice. Starts
// assuming "light" (this app's CSS default) and corrects itself on mount
// by reading the same two sources the inline script already used, so the
// one-paint lag between "page renders" and "button reflects the real
// theme" is the only cost of not duplicating that read into a second
// blocking script.
type Theme = "light" | "dark";

function detectTheme(): Theme {
  try {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable (private browsing, etc.) -- fall through to OS preference.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(detectTheme());
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Persistence is a nicety, not a requirement -- the choice still applies this session.
    }
  }

  return (
    <div className="flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--sunk)] p-0.5">
      {(["light", "dark"] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => choose(t)}
          aria-pressed={theme === t}
          className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium capitalize transition-colors ${
            theme === t ? "bg-[var(--ink)] text-[var(--shell)]" : "text-[var(--ink3)] hover:text-[var(--ink2)]"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
