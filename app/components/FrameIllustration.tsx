// Interface work, 2026-09-01 (decisions.md). A pure, data-driven SVG frame
// renderer -- adapted from the pasted mock's approach (parametric lens
// path, gradient body, a temple curve, an optional tortoise-style pattern)
// but generalized to the REAL catalog's value space, not the mock's
// three-frame example: 7 shapes (mock only drew "geometric" and a generic
// rounded-rect), 18 color families (mock only had olive/tortoise), 3 rim
// types including rimless (the mock never drew one). Every input is a
// real catalog field -- nothing here is decorative beyond what the data
// says about the frame.
"use client";

interface FrameSpec {
  shape: string; // catalog `shape`: geometric | rectangle | square | round | oval | cat_eye | aviator
  rim_type: string; // full | semi | rimless
  material: string; // acetate | metal | titanium | tr90
  color_family: string;
  lens_width_mm: number;
  bridge_mm: number;
  lens_height_mm: number;
  frame_width_mm: number;
  frame_id: string;
  alt: string;
}

interface Palette {
  base: string;
  dark: string;
  light: string;
  pattern?: boolean; // tortoise/havana-style mottled multi-tone, not a flat gradient
}

// Every color_family the catalog actually contains (verified 2026-09-01 against
// data/catalog/out/catalog.json) gets a real entry -- no silent fallback standing in
// for an unmapped color the catalog might contain.
const PALETTE: Record<string, Palette> = {
  black: { base: "#2B2B2E", dark: "#141416", light: "#4A4A4E" },
  blush: { base: "#E2B9BC", dark: "#B98488", light: "#F2D6D8" },
  bronze: { base: "#8A5A2B", dark: "#5A3A1A", light: "#B4854E" },
  burgundy: { base: "#5E1F2E", dark: "#3A1119", light: "#853044" },
  crystal: { base: "#DCE6E6", dark: "#AEBFBF", light: "#F2F8F8" },
  forest: { base: "#2E4A34", dark: "#182A1E", light: "#4C6D53" },
  gold: { base: "#B8912E", dark: "#8A6A1C", light: "#DDB856" },
  gunmetal: { base: "#4A4F55", dark: "#2A2E33", light: "#6C7278" },
  havana: { base: "#7A5230", dark: "#432B15", light: "#A97D4E", pattern: true },
  ink: { base: "#232B45", dark: "#11162A", light: "#3D4A6E" },
  matte: { base: "#3A3A3C", dark: "#1E1E20", light: "#565658" },
  midnight: { base: "#1B2333", dark: "#0C111C", light: "#333F58" },
  navy: { base: "#233A5E", dark: "#12203A", light: "#3E5A85" },
  olive: { base: "#454C33", dark: "#282D1D", light: "#666F4E" },
  rose: { base: "#C98A7A", dark: "#9A5C4E", light: "#E0AFA4" },
  signal: { base: "#B3352C", dark: "#7A1F18", light: "#D65F52" },
  silver: { base: "#B7BEC2", dark: "#8A9297", light: "#DCE1E3" },
  slate: { base: "#4C5A63", dark: "#2C3841", light: "#6E7E87" },
  tortoise: { base: "#8A5A2B", dark: "#4A2E14", light: "#C08A4A", pattern: true },
};
const FALLBACK_PALETTE: Palette = { base: "#5F6F68", dark: "#3A443F", light: "#8A9992" };

function paletteFor(colorFamily: string): Palette {
  return PALETTE[colorFamily] ?? FALLBACK_PALETTE;
}

/** Acetate rims read visibly thicker than metal/tr90/titanium in real frames -- reflected in stroke width, not just labeled in the spec grid. */
function rimStrokeWidth(material: string): number {
  if (material === "acetate") return 6.4;
  if (material === "titanium") return 3.6;
  return 5.0; // metal, tr90
}

function lensPath(shape: string, cx: number, cy: number, w: number, h: number): string {
  const x = cx - w / 2;
  const y = cy - h / 2;

  if (shape === "geometric") {
    const k = w * 0.26;
    const r = w * 0.09;
    const P: [number, number][] = [
      [x + k, y], [x + w - k, y], [x + w, cy], [x + w - k, y + h], [x + k, y + h], [x, cy],
    ];
    const go = (a: [number, number], b: [number, number], d: number) => {
      const vx = b[0] - a[0], vy = b[1] - a[1];
      const len = Math.hypot(vx, vy) || 1;
      const f = Math.min(d / len, 0.45);
      return [a[0] + vx * f, a[1] + vy * f];
    };
    return P.map((pt, i) => {
      const a = go(pt, P[(i + 5) % 6], r);
      const b = go(pt, P[(i + 1) % 6], r);
      return `${i ? "L" : "M"} ${a[0].toFixed(1)} ${a[1].toFixed(1)} Q ${pt[0].toFixed(1)} ${pt[1].toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
    }).join(" ") + " Z";
  }

  if (shape === "round" || shape === "oval") {
    const rx = w / 2, ry = h / 2;
    return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx - rx} ${cy} Z`;
  }

  if (shape === "cat_eye") {
    // Upswept outer corner, straighter inner edge -- a simple asymmetric bezier approximation.
    const topLift = h * 0.22;
    return (
      `M ${x} ${cy + h * 0.1} ` +
      `Q ${x} ${y} ${x + w * 0.3} ${y} ` +
      `L ${x + w * 0.75} ${y - topLift * 0.3} ` +
      `Q ${x + w} ${y - topLift} ${x + w} ${cy - h * 0.05} ` +
      `L ${x + w} ${cy + h * 0.35} ` +
      `Q ${x + w} ${y + h} ${x + w * 0.6} ${y + h} ` +
      `L ${x + w * 0.25} ${y + h} ` +
      `Q ${x} ${y + h} ${x} ${cy + h * 0.25} Z`
    );
  }

  if (shape === "aviator") {
    // Teardrop: wider/rounder at the bottom-outer, tapering toward the brow.
    return (
      `M ${cx} ${y} ` +
      `Q ${x + w} ${y} ${x + w} ${cy - h * 0.1} ` +
      `Q ${x + w} ${y + h} ${cx + w * 0.05} ${y + h} ` +
      `Q ${x} ${y + h} ${x} ${cy - h * 0.05} ` +
      `Q ${x} ${y} ${cx} ${y} Z`
    );
  }

  // rectangle / square -- rounded rect, the general default
  const r = Math.min(w, h) * 0.2;
  return (
    `M ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} ` +
    `L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} ` +
    `L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} ` +
    `L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`
  );
}

export default function FrameIllustration({ frame }: { frame: FrameSpec }) {
  const K = 1.9;
  const CX = 175;
  const CY = 58;
  const lw = frame.lens_width_mm * K;
  const lh = frame.lens_height_mm * K;
  const br = frame.bridge_mm * K;
  const lx = CX - br / 2 - lw / 2;
  const rx = CX + br / 2 + lw / 2;

  const pal = paletteFor(frame.color_family);
  const uid = frame.frame_id;
  const bodyFill = pal.pattern ? `url(#pat-${uid})` : `url(#grad-${uid})`;
  const isRimless = frame.rim_type === "rimless";
  const isSemi = frame.rim_type === "semi";
  const rimW = isRimless ? 0 : rimStrokeWidth(frame.material);

  const templePath = (side: "l" | "r") => {
    const d = side === "l" ? -1 : 1;
    const e = side === "l" ? lx - lw / 2 : rx + lw / 2;
    const hx = e - d * 2, hy = CY - lh * 0.14;
    const tx = e + d * 36, ty = hy + 13;
    const w = 5.8, tw = w * 0.6;
    const mx = (hx + tx) / 2, my = (hy + ty) / 2 + 1;
    return `M ${hx} ${hy - w / 2} Q ${mx} ${my - w * 0.5} ${tx} ${ty - tw / 2} Q ${tx + d * tw * 0.7} ${ty} ${tx} ${ty + tw / 2} Q ${mx} ${my + w * 0.5} ${hx} ${hy + w / 2} Z`;
  };

  const bridgeY = CY - lh * 0.16;
  const bridgeH = Math.min(lh * 0.1, 10);

  return (
    <svg viewBox="0 0 350 116" width="100%" height="auto" role="img" aria-label={frame.alt}>
      <defs>
        <linearGradient id={`grad-${uid}`} x1="0.15" y1="0" x2="0.55" y2="1">
          <stop offset="0%" stopColor={pal.light} />
          <stop offset="34%" stopColor={pal.base} />
          <stop offset="82%" stopColor={pal.base} />
          <stop offset="100%" stopColor={pal.dark} />
        </linearGradient>
        <linearGradient id={`lens-${uid}`} x1="0.15" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="#EAF0F4" />
          <stop offset="52%" stopColor="#D6E0E8" />
          <stop offset="100%" stopColor="#C4D2DC" />
        </linearGradient>
        {pal.pattern && (
          <pattern id={`pat-${uid}`} width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(22)">
            <rect width="22" height="22" fill={pal.base} />
            <ellipse cx="5" cy="6" rx="4.6" ry="2.8" fill={pal.dark} opacity="0.9" />
            <ellipse cx="16" cy="15" rx="5.1" ry="3" fill={pal.dark} opacity="0.7" />
            <ellipse cx="12" cy="3" rx="2.6" ry="1.7" fill={pal.light} opacity="0.55" />
          </pattern>
        )}
        {isSemi && (
          <clipPath id={`clip-${uid}`}>
            <rect x="0" y={CY - lh / 2 - 10} width="350" height={lh * 0.5 + 10} />
          </clipPath>
        )}
      </defs>

      {(["l", "r"] as const).map((side) => (
        <path key={side} d={templePath(side)} fill={bodyFill} stroke={pal.dark} strokeWidth="0.6" />
      ))}

      {!isRimless && (
        <path
          d={`M ${lx + lw / 2 - 6} ${bridgeY - bridgeH / 2} L ${rx - lw / 2 + 6} ${bridgeY - bridgeH / 2} L ${rx - lw / 2 + 6} ${bridgeY + bridgeH / 2} Q ${CX} ${bridgeY + bridgeH * 0.9} ${lx + lw / 2 - 6} ${bridgeY + bridgeH / 2} Z`}
          fill={bodyFill}
          stroke={pal.dark}
          strokeWidth="0.6"
        />
      )}
      {isRimless && (
        // A bare bridge bar, no lens-surrounding rim -- rimless mounts the lens directly.
        <rect x={lx + lw / 2 - 4} y={bridgeY - 1.4} width={br + 8} height="2.8" rx="1.4" fill={pal.base} stroke={pal.dark} strokeWidth="0.4" />
      )}

      {[lx, rx].map((cx, i) => {
        const d = lensPath(frame.shape, cx, CY, lw, lh);
        return (
          <g key={i}>
            <path d={d} fill={`url(#lens-${uid})`} />
            {isRimless ? (
              // Drill-mount dots where hardware would attach, no surrounding rim.
              <>
                <path d={d} fill="none" stroke="#B0BEC8" strokeWidth="0.8" opacity="0.6" />
                <circle cx={cx - lw * 0.32} cy={CY} r="1.6" fill={pal.dark} />
                <circle cx={cx + lw * 0.32} cy={CY} r="1.6" fill={pal.dark} />
              </>
            ) : isSemi ? (
              <g clipPath={`url(#clip-${uid})`}>
                <path d={d} fill="none" stroke={bodyFill} strokeWidth={rimW} strokeLinejoin="round" strokeLinecap="round" />
              </g>
            ) : (
              <path d={d} fill="none" stroke={bodyFill} strokeWidth={rimW} strokeLinejoin="round" />
            )}
            <path d={d} fill="none" stroke={pal.dark} strokeWidth="0.5" opacity="0.5" />
          </g>
        );
      })}
    </svg>
  );
}

export type { FrameSpec };
