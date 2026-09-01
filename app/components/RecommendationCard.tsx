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
    <span className="inline-block mt-2.5 text-[11px] font-medium bg-[#E7F0EC] text-[#14493E] px-2.5 py-1 rounded">
      styling convention
    </span>
  );
}

export default function RecommendationCard({ frame, gloss, citationMarker, claimType, droppedClause }: Props) {
  const isNearMiss = Boolean(droppedClause);

  return (
    <div className="border border-[#DFE6E2] rounded-md bg-[#FDFEFD] mb-3 overflow-hidden">
      {isNearMiss && (
        <div className="bg-[#FBF1E0] text-[#8A5A0B] text-[13px] font-medium px-4 py-2 border-b border-[#EAD9B4]">
          Closest option — doesn&apos;t meet: {droppedClause}
        </div>
      )}
      <div className="flex gap-4 p-4 items-start flex-wrap">
        <div className="w-[150px] min-w-[130px] flex-none bg-[#F1F4F3] rounded p-1.5">
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
          <div className="flex justify-between gap-3 items-baseline border-b border-[#DFE6E2] pb-2">
            <div className="font-semibold text-[20px] leading-tight text-[#14201C] tracking-tight">
              {frame.brand} {frame.model}
            </div>
            <div className="font-semibold text-[20px] leading-tight text-[#14201C] tabular-nums whitespace-nowrap">
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
                <div className="text-[10.5px] font-medium text-[#8A9992] mb-0.5">{k}</div>
                <div className="text-[13.5px] text-[#14201C] tabular-nums">{v}</div>
              </div>
            ))}
          </div>

          {!frame.in_stock && (
            <div className="mt-2 text-[12px] font-medium text-[#8A5A0B]">Currently out of stock</div>
          )}

          {gloss && (
            <p className="text-[15px] leading-relaxed text-[#14201C] mt-3 max-w-[56ch]" style={{ fontFamily: "var(--font-serif)" }}>
              {gloss}
              {citationMarker && <sup className="text-[10px] font-medium text-[#14493E] ml-0.5">[{citationMarker}]</sup>}
            </p>
          )}

          {claimType === "convention" && <ConventionTag />}
        </div>
      </div>

      {isNearMiss && (
        <div className="border-t border-[#DFE6E2] px-4 py-2.5 flex flex-wrap gap-x-6 gap-y-1 text-[12px]">
          <span className="text-[#8A5A0B]"><b className="font-medium">Gives up:</b> {droppedClause}</span>
          <span className="text-[#5F6F68]"><b className="font-medium text-[#14201C]">Keeps:</b> everything else you asked for</span>
        </div>
      )}
    </div>
  );
}
