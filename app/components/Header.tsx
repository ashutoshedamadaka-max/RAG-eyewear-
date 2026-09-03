"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Shared across all four pages (decisions.md, 2026-09-03) -- rendered once
// in the root layout, not per-page, so it can never drift between routes.
// A client component only because `usePathname` needs it -- everything it
// renders is otherwise static.
const NAV = [
  { href: "/", label: "Demo" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/evals", label: "Evals" },
  { href: "/baseline", label: "Baseline" },
] as const;

export default function Header() {
  const pathname = usePathname();
  return (
    <header className="h-14 flex-none border-b border-[#DFE6E2] bg-[#FDFEFD] px-6 flex items-center justify-between gap-4">
      <Link href="/" className="text-[14px] font-semibold text-[#14201C] tracking-tight">
        Eyewear RAG
      </Link>
      <nav className="flex items-center gap-1 text-[13px]">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`px-2.5 py-1.5 rounded-md ${
                active ? "bg-[#14201C] text-white font-medium" : "text-[#5F6F68] hover:text-[#14201C] hover:bg-[#EEF2F0]"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
