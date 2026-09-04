"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";

// Visual rebuild (decisions.md, 2026-09-04): the prototype's `.bar`, now
// inside the shell (root layout.tsx) rather than a separate full-width
// strip above it. Shared across all four pages -- a client component
// only because `usePathname` needs it, everything else here is static.
const NAV = [
  { href: "/", label: "Demo" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/evals", label: "Evals" },
  { href: "/baseline", label: "Baseline" },
] as const;

export default function Header() {
  const pathname = usePathname();
  return (
    <header className="h-[54px] flex-none flex items-center gap-[22px] px-5 border-b border-[var(--line2)]">
      <Link href="/" className="text-[15px] font-semibold text-[var(--ink)] tracking-tight flex items-center gap-2">
        Specs
        <span className="text-[12px] font-normal text-[var(--ink3)] border-l border-[var(--line)] pl-2">
          eyewear recommender
        </span>
      </Link>
      <nav className="ml-auto flex items-center gap-0.5">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`px-2.5 py-1.5 rounded-[7px] text-[13px] font-medium transition-colors ${
                active ? "bg-[var(--acc-lt)] text-[var(--acc)]" : "text-[var(--ink2)] hover:bg-[var(--sunk)]"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <ThemeToggle />
    </header>
  );
}
