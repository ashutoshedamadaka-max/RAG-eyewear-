"use client";

import FrameIllustration from "./FrameIllustration";
import type { ParsedFrame } from "./conversation-types";

interface Props {
  frame: ParsedFrame;
  gloss?: string;
  citationMarker?: string;
  claimType?: "physical" | "convention";
  /** Present only for a near-miss frame -- what the relaxation ladder dropped to surface it. */
  droppedClause?: string;
}

/** "conventionally suggested" reads for face_shape_suits/style_tags boosts get a tag; nothing else does -- matches derive.ts's own rule that only face_shape/style produce a citable convention claim on a card, price/fit facts are just facts. */
function ConventionTag() {
  return (
    <span className="inline-block mt-2.5 text-[11px] font-medium bg-[var(--acc-lt)] text-[var(--acc)] px-2.5 py-1 rounded-full">
      styling convention
    </span>
  );
}

export default function RecommendationCard({ frame, gloss, citationMarker, claimType, droppedClause }: Props) {
  const isNearMiss = Boolean(droppedClause);

  return (
    <div className="border border-[var(--line)] rounded-[14px] bg-[var(--block)] mb-3 overflow-hidden">
      {isNearMiss && (
        <div className="bg-[var(--warn-lt)] text-[var(--warn)] text-[12.5px] font-medium px-4 py-2 border-b border-[var(--line)]">
          Closest option — doesn&apos;t meet: {droppedClause}
        </div>
      )}
      <div className="flex gap-4 p-4 items-start flex-wrap">
        <div className="w-[142px] min-w-[124px] flex-none bg-[var(--sunk)] rounded-[10px] p-1.5">
          <FrameIllustration
            frame={{
              frame_id: frame.frame_id,
              shape: frame.shape,
              rim_type: frame.rim_type,
              material: frame.material,
              color_family: frame.color,
              lens_width_mm: frame.lens_width_mm,
              bridge_mm: frame.bridge_mm,
              lens_height_mm: frame.lens_height_mm,
              frame_width_mm: frame.frame_width_mm,
              alt: `${frame.brand} ${frame.model}, ${frame.shape} ${frame.rim_type}-rim ${frame.material} frame in ${frame.color}`,
            }}
          />
        </div>

        <div className="flex-1 min-w-[210px]">
          <div className="flex justify-between gap-3 items-baseline border-b border-[var(--line2)] pb-2">
            <div className="font-semibold text-[18px] leading-tight text-[var(--ink)] tracking-tight">
              {frame.brand} {frame.model}
            </div>
            <div className="font-semibold text-[18px] leading-tight text-[var(--ink)] tabular-nums whitespace-nowrap">
              ₹{frame.price_frame_only.toLocaleString("en-IN")}
            </div>
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3">
            {[
              ["Size", `${frame.lens_width_mm}⨯${frame.bridge_mm}–${frame.temple_mm}`],
              ["Lens height", `${frame.lens_height_mm} mm`],
              ["Weight", `${frame.weight_g} g`],
              ["Width", `${frame.frame_width_mm} mm, ${frame.face_width_fit}`],
              ["Build", `${frame.material}, ${frame.rim_type}-rim`],
            ].map(([k, v]) => (
              <div key={k}>
                <div className="text-[10.5px] font-medium text-[var(--ink3)] mb-0.5">{k}</div>
                <div className="text-[13.5px] text-[var(--ink)] tabular-nums">{v}</div>
              </div>
            ))}
          </div>

          {!frame.in_stock && (
            <div className="mt-2 text-[12px] font-medium" style={{ color: "var(--warn)" }}>
              Currently out of stock
            </div>
          )}

          {gloss && (
            <p className="text-[15px] leading-relaxed text-[var(--ink)] mt-3 max-w-[50ch]" style={{ fontFamily: "var(--font-serif)" }}>
              {gloss}
              {citationMarker && <sup className="text-[10px] font-medium text-[var(--acc)] ml-0.5">[{citationMarker}]</sup>}
            </p>
          )}

          {claimType === "convention" && <ConventionTag />}
        </div>
      </div>

      {isNearMiss && (
        <div className="border-t border-[var(--line2)] flex flex-wrap">
          <div className="flex-1 min-w-[165px] px-4 py-3">
            <div className="text-[10.5px] font-medium text-[var(--ink3)] mb-1.5">Gives up</div>
            <div className="text-[13px] leading-[1.55]" style={{ color: "var(--warn)" }}>
              {droppedClause}
            </div>
          </div>
          <div className="flex-1 min-w-[165px] px-4 py-3 border-l border-[var(--line2)]">
            <div className="text-[10.5px] font-medium text-[var(--ink3)] mb-1.5">Keeps</div>
            <div className="text-[13px] leading-[1.55] text-[var(--ink2)]">everything else you asked for</div>
          </div>
        </div>
      )}
    </div>
  );
}
