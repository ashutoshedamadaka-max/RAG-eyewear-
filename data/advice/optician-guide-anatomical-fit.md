---
title: "Anatomical frame fitting — authored optician guide"
source_org: "Independent practising optician (author not otherwise identified in the source document)"
source_document: "\"The Ultimate Eyewear Knowledge Base: Frames, Lenses, and Fitting Guide\", section 3 (\"Frame Sizing, Metrics, & Anatomical Fit\")"
source_type: "Authored guide, not an interview transcript"
source_provenance: "Privately shared by the project owner via Google Docs, received 2026-08-27; never previously committed to this repository or fetched from a public URL. Single-source and not peer-reviewed -- unlike the six vendor/CE documents already in this corpus, this is one practising optician's own written material, not cross-checked against another professional's review. See decisions.md 2026-08-31 for full provenance history, including an earlier mischaracterization of this source as an interview."
claim_type: physical
verified: 2026-08-31
verification_method: "Full document read directly (provided by the project owner, not fetched). This file's content cross-checked against this project's own independently-derived fit rules (PROJECT_CONTEXT.md §3, added 2026-08-28, before this document existed in the repo) -- corroborates rather than conflicts on every point. The source document's lens-height category table (implying a >44mm progressive-height minimum) is deliberately EXCLUDED from this file -- it is the origin of the unsupported 44mm claim already logged 2026-08-28/29, and this corpus's precedence rule (vendor documentation wins on technical conflict for a single-source, non-peer-reviewed document) means it does not get ingested as a physical claim here. See decisions.md 2026-08-31."
---

# Anatomical frame fitting — authored optician guide

## Frame width and face width

> "Proper frame sizing is a clinical requirement for lens alignment and the
> primary factor in long-term wearing comfort. If the frame is too wide or
> too narrow, the optical centers of the lenses will not sit before the
> pupils, causing distortion. Face Width — the distance from temple to
> temple — is our primary metric. Symmetry and proportion are the goal;
> the frame should finish exactly on the outside of the cheekbones."

> "Overall Frame Width Formula: (2 × Eye Size) + DBL."

This is the same formula this project's catalog invariant check already
verified empirically against `data/catalog/out/catalog.json`
(`frame_width_mm ≈ 2×lens_width_mm + bridge_mm` + a small hinge/endpiece
allowance, PROJECT_CONTEXT.md §3) — independent corroboration, not the
original source of that check, since the invariant was verified before
this document was in the repo.

## Temple arm tension (splaying and pressing)

> "Temple Arm Tension: Arms must line up with the sides of the face.
> Splaying outward indicates the frame is too small; inward pressing
> indicates it is too wide."

Matches this project's `fit_issues ∋ splaying` / `fit_issues ∋ pressing`
derivation rows exactly (PROJECT_CONTEXT.md §3, "Fit-rule correction:
splaying/pressing," decisions.md 2026-08-28) — that correction was written
based on this same guide's content, relayed by the project owner before
the document itself existed in this corpus. This chunk is the primary
source finally landing where it can be cited directly.

## Cheekbone alignment

> "Cheekbone Alignment: The lower rim must not rest on the cheeks, or the
> glasses will 'jump' when you smile or speak."

Matches `fit_issues ∋ cheekbone_contact` exactly (added 2026-08-28, same
relayed-then-sourced pattern as above).

## Long face ratio

> "Face Length Ratios: A 'Long Face' is identified when the length is
> >= 1.5 * width. Long faces require taller lenses to balance the vertical
> proportions."

Matches the "long face (face_length ≥ 1.5 × face_width) → boost taller
lens_height_mm" derivation row exactly (added 2026-08-28).

## Nose bridge and profile

> "Nose Bridge & Profiles: Bridge fit dictates stability. Narrow-set eyes
> require a DBL of 14–18mm, while wide-set eyes require 19–22mm. Patients
> with a flat nose profile require adjustable nose pads to prevent the
> frame from hitting the eyelashes. Conversely, those with prominent
> bridges benefit from fixed plastic (acetate) bridges, which utilize the
> nose's natural structure for a stable, integrated fit."

Matches four separate derivation rows exactly: the close-set/wide-set
`bridge_mm` boosts, "flat nose profile → `nose_pad_type = adjustable`,"
and "prominent nose bridge → prefer `nose_pad_type = fixed_integrated` ∧
`material = acetate`" (all added 2026-08-28).

## What was deliberately left out of this file

The source document's section 3 also contains a lens-height category
table (Short <36mm / Medium 36–44mm / Tall >44mm, with >44mm marked
"Clinical Requirement" for progressive blending). That table is the
origin of this project's earlier "optician says >44mm" figure
(decisions.md 2026-08-28, 2026-08-29) — checked against Rodenstock, Zeiss,
and HOYA documentation and found unsupported there (their own
longest-corridor product lines top out at 34–36mm B-height, nowhere near
44mm). Per this corpus's precedence rule, vendor documentation wins on a
technical conflict against a single-source, non-peer-reviewed guide, so
this table is not ingested as a physical claim in this corpus. See
`rodenstock-frame-fitting-heights.md` and
`opticampus-progressive-lens-dispensing.md` for the figures this project
actually uses (`PROGRESSIVE_MIN_B_HEIGHT_MM`).
