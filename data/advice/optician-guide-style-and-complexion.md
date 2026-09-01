---
title: "Style, complexion, and the eyewear-wardrobe framing — authored optician guide"
source_org: "Independent practising optician (author not otherwise identified in the source document)"
source_document: "\"The Ultimate Eyewear Knowledge Base: Frames, Lenses, and Fitting Guide\", sections 2 (\"The 'Eyewear Wardrobe' Lifestyle Framework\") and 4 (\"Aesthetics, Complexion, & Styling Contrasts\")"
source_type: "Authored guide, not an interview transcript"
source_provenance: "Privately shared by the project owner via Google Docs, received 2026-08-27; never previously committed to this repository. Single-source and not peer-reviewed. See decisions.md 2026-08-31 for full provenance history."
claim_type: convention
verified: 2026-08-31
verification_method: "Full document read directly (provided by the project owner, not fetched). Tagged convention, not physical: face-shape-to-frame-style pairing and complexion/metal-tone matching are style guidance this project already treats as the weakest claim tier (PROJECT_CONTEXT.md §3, 'Face-shape-to-frame convention is the weakest claim in the knowledge base' -- written 2026-08-27/28, before this source existed in the repo), not a fitting requirement. This is the first real convention-tagged content in the corpus; previously the hedging-match judge (app/lib/judges.ts) had only been validated against a synthetic placeholder chunk (decisions.md 2026-08-31, judge-validation entry) because no real convention source existed yet."
---

# Style, complexion, and the eyewear-wardrobe framing

## The "eyewear wardrobe" framing

> "The 'one pair for everything' approach is a modern optical fallacy that
> leads directly to visual fatigue and systemic failure. Relying on a
> single prescription for driving, 10-hour screen days, and social events
> is as fundamentally flawed as wearing the same pair of shoes for a
> wedding, a 10k run, and gardening."

The source proposes a consultative "Eyewear Wardrobe" spanning
everyday/general use, professional/client meetings, computer/digital
work, special occasions, driving, polarised sunglasses, and DIY/safety
work — categories that map directly onto this project's existing
`purpose_tags[]` slot, with no new data needed. This is the primary
source for the "eyewear wardrobe" idea already logged as future work
(PROJECT_CONTEXT.md §11, decisions.md 2026-08-28), landing here as
citable content rather than a paraphrased idea. The source also cites a
specific consumer survey (glasses-ownership rates vs. shoe-ownership
rates) to motivate the framing; that statistic is this single document's
own unverified citation, not independently confirmed by this project, and
should be treated as illustrative rather than as a checkable fact if ever
surfaced in generated copy.

## Face shape architecture

> "Styling relies on the 'Principle of Opposites' to achieve visual
> balance. We select frames that counter the natural architecture of the
> face rather than amplifying its extremes."

> "Square Faces: Strong jawlines and equal width/length. Rounded or oval
> frames soften these angles, though angular frames can be used
> intentionally to accentuate a chiseled look."
> "Round Faces: Widest at the cheekbones. Use boxy, square, or rectangular
> frames to provide structure and contrast."
> "Heart Faces: Wide forehead narrowing to a chin. Balance with
> bottom-heavy styles; strictly avoid top-heavy half-rims, which emphasize
> forehead width."
> "Oval Faces: The 'Universal' shape. Most styles work, provided the frame
> width matches the cheekbones to maintain symmetry."

This is styling convention, explicitly framed by this project as a soft
ranking nudge only (`face_shape` → boost `face_shape_suits ∋ value`, +0.15
max, never a filter — PROJECT_CONTEXT.md §3, decisions.md 2026-08-27) —
not a fitting requirement, and the source material itself doesn't claim
otherwise; "principle of opposites" is presented as a styling heuristic,
not a physical necessity.

## Complexion and metal selection

> "The 'Contrast Rule' dictates that light tortoise shell pops on dark
> skin, while dark tortoise provides definition for light skin. For
> metals, we use the Wrist Vein Test to determine undertones:"
> "Green Veins (Warm): Use Platinum-Finish Silver or brushed pewter."
> "Blue Veins (Cool): Use High-grade Ion-Plated Gold or rose gold finishes."

This is the complexion/undertone guidance this project previously deferred
(decisions.md 2026-08-28, "Deferred: complexion/undertone styling
advice") pending a deliberate decision about whether to ask users their
skin tone. Bringing this content into the retrievable corpus is **not**
that decision — see PROJECT_CONTEXT.md §11 for the explicit boundary: this
content may inform an explanation if relevant context makes it useful, but
does not become a question the conversation layer asks. It remains
`claim_type: convention` — hedged, never a filter, never solicited as a
STATED slot.
