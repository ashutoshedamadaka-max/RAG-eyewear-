import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Header from "@/components/Header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Eyewear RAG — A Fitting Conversation",
  description:
    "A conversational eyewear recommender: structured catalog filters plus cited, hedged optician advice, one agent orchestrating both.",
};

// Runs before hydration, in <head>, so the right theme is already applied
// the instant the page paints -- no flash of the wrong theme while React
// boots. Reads the SAME two sources ThemeToggle.tsx's `detectTheme` reads
// (localStorage, then prefers-color-scheme), kept in sync deliberately:
// if this script's logic ever needs to change, that function does too.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

// Visual rebuild (decisions.md, 2026-09-04), against a supplied prototype
// treated as a visual spec, not copied as code: "the app is an object" --
// a rounded, shadowed shell floating on a tinted `--field` page
// background, not an edge-to-edge layout. Header (the prototype's `.bar`)
// now renders INSIDE the shell, once, shared by all four routes, so
// every page gets the same floating-card framing automatically. The
// previous round's fixed-viewport dual-scroll-region shell (h-full +
// overflow-hidden on <body>) is gone -- the supplied prototype's
// machinery panel uses `position: sticky` + its own bounded
// `overflow-y: auto` instead, which needs a normally-scrolling page
// underneath it, not a second competing scroll container.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen p-3 sm:p-5 md:p-[22px]">
        <div className="max-w-[1240px] mx-auto rounded-[18px] border border-[var(--edge)] bg-[var(--shell)] shadow-[var(--shadow)] overflow-hidden">
          <Header />
          {children}
        </div>
      </body>
    </html>
  );
}
