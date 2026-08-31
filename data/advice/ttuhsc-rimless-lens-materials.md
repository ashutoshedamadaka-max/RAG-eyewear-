---
title: "The Art and Science of Rimless Eyewear — lens material selection for drilled mounting"
source_org: Texas Tech University Health Sciences Center (TTUHSC), ABO-NCLE continuing education
source_document: "The Art and Science of Rimless Eyewear, Part 1" (2018-03-26)
source_url: "https://www.ttuhsc.edu/medicine/ophthalmology/documents/The_Art_and_Science_of_Rimless_Eyewear_Part_1.pdf"
source_url_note: "Live URL returned 404 on 2026-08-28; fetched via Wayback Machine snapshot dated 2026-04-12 (http://web.archive.org/web/20260412052614/...)."
claim_type: physical
verified: 2026-08-28
verification_method: "Downloaded PDF via web.archive.org, extracted text with pypdf (14 pages)."
---

# The Art and Science of Rimless Eyewear — lens material selection

## Drilled rimless lens material recommendations

The single most load-bearing fact in this document for this project — a
real table, not an approximation:

> "Drilled Rimless Lens Material Recommendations"
>
> | Lens Material | Index | Tensile Strength | Specific Gravity | Abbe Value | Recommended |
> |---|---|---|---|---|---|
> | CR 39 | 1.50 | 15.6 kgf | 1.32 | 58 | |
> | Trivex | 1.53 | 61.2 kgf | 1.11 | 44 | |
> | Polycarbonate | 1.59 | 44.9 kgf | 1.20 | 30 | |
> | 1.60 High Index | 1.60 | 80.5 kgf | 1.22 | 41 | |
> | 1.67 High Index | 1.67 | 67.3 kgf | 1.36 | 32 | |
> | 1.74 High Index | 1.74 | 31.6 kgf | 1.47 | 33 | For a high Rx |

**1.74 has the lowest tensile strength of the three high-index materials
listed (31.6 kgf) — under half of 1.67's (67.3 kgf) and well under half of
1.60's (80.5 kgf).** The table marks 1.74 "Recommended... For a high Rx" —
i.e. for the lens-thinness benefit at high prescriptions — without
claiming it's the strongest choice for drill-mounting. Those are two
different recommendation axes the table itself doesn't collapse into one.

## Selection guidance

> "When selecting a rimless lens shape the patients Rx must always be
> considered, this is especially true with higher plus or minus
> prescriptions... Special care should be taken in shape selection to
> ensure the lenses will be as thin as possible without compromising
> durability."
> — "Lens Selection – Best Practices"

> "To minimize thickness choose a smaller lens size, this is because for a
> given prescription as the lens diameter increases, lens thickness
> increases proportionally... Irregular lens shapes with higher effective
> diameters require larger lens blanks and can increase the lens
> thickness. More regular (circular) lens shapes keep the lens thickness
> to a minimum."
> — "Lens Selection – Best Practices"

This is the direct primary-source support for "sag depth scales with
frame size" — the course doesn't use the word "sag," but the proportional
relationship between diameter and thickness for a given prescription is
exactly that relationship stated in plain dispensing language.

## Mounting practice (context, not load-bearing for the derivation rule)

> "It is important to be sure holes are chamfered on both lens surfaces."
> — "Mounting Rimless Lenses — Compression Sleeve Mounting"

> "There is one important thing that must always be done when adjusting
> rimless eyewear! ... Correct support for face form... Always provide
> support from the top of the lens."
> — "Adjusting Rimless Eyewear"

## Application to this project

This is the source for `app/lib/derivation.ts#assessLensIndex`'s decision
**not** to encode "rimless → always recommend the highest index available."
1.74's tensile strength (31.6 kgf) being the lowest of the three
high-index options, not the highest, is a direct, specific, sourced fact
— not a hedge or a general principle. The function caps its suggested
index at 1.67 for rimless mounting specifically because of this table, and
says so in its `reason` output.
