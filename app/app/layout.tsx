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

// Four-page restructure (decisions.md, 2026-09-03): Header renders exactly
// once here, shared by /, /how-it-works, /evals, /baseline, instead of
// each page owning its own. `h-14` on Header + `h-[calc(100dvh-56px)]` is
// what lets the demo page build a true fixed-viewport, independently-
// scrolling two-column layout without any page needing to know the
// header's height as a magic number more than once.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col">
        <Header />
        {/* overflow-y-auto is the default so a normal page (evals, how-it-works, baseline)
            just scrolls -- no page needs to opt in. The demo page opts OUT by giving its own
            root a matching h-full + overflow-hidden, so its two columns can scroll independently
            instead of the whole page scrolling as one. */}
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      </body>
    </html>
  );
}
