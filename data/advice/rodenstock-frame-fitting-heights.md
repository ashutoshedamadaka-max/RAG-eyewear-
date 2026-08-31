---
title: "Frame and fitting heights for Rodenstock progressive lenses"
source_org: Rodenstock GmbH
source_document: "Tips & Technology 2022" (chapter 2.6, "Frame and Fitting Heights", Table 2-3) and "Instructions for use — Rodenstock Progressive lenses, for opticians" (version January 2022)
source_url: "https://www.rodenstock.com/fallback/dam/jcr:0c9cda81-d231-4413-93b4-eba96e371b33/tips_and_technology_2022_en.pdf"
source_url_secondary: "https://www.rodenstock.com/fallback/dam/jcr:2316944c-682b-40a9-a059-7c21599f7236/instructions_for_use_rodenstock_progressive_lenses.pdf"
claim_type: physical
verified: 2026-08-28
verification_method: "Downloaded both PDFs directly, extracted text with pypdf, confirmed against page images not available (text-layer extraction only)."
---

# Frame and fitting heights for Rodenstock progressive lenses

## Two different measurements, not one

Rodenstock's own instructions distinguish two vertical measurements that are
easy to conflate:

> "When determining the centring, the minimum grinding heights (position of
> the reference point near + 2 mm) and minimum distances to the upper edge
> of the frame (position of the reference point far + 8 mm) must be
> observed."
> — *Instructions for use — Rodenstock Progressive lenses*, §3 "Correct use"

**Fitting height** is the vertical distance from the lowest point of the
lens to the pupil centre (the reference point used when the optician takes
a fitting-height measurement on the wearer). **Frame height** (the "B"
measurement, i.e. the full vertical opening of the lens/frame) is a
different, larger number, because it has to include clearance both below
the pupil (for the near-vision zone) and above it (for the far-vision zone
and mounting margin).

## Table 2-3: minimum frame and fitting heights, by design type

From *Tips & Technology 2022*, chapter 2.6:

| Design type | V (individual) | S (short) | M (medium) | L (long) |
|---|---|---|---|---|
| Minimum fitting height | 15–22mm | 16mm | 18mm | 20mm |
| Minimum frame height | 23–34mm | 24mm | 26mm | 28mm |

> "Table 2-3: Minimum frame and fitting heights of Rodenstock progressive
> lenses"

A second table for Rodenstock's near-comfort ("Ergo") lens family (chapter
3.6) gives minimum frame heights in the 25–36mm range depending on design
type, and a third (chapter 6.4, for a further product line) gives 28–32mm.

For Impression B.I.G. individual-design lenses, Rodenstock gives the
formula directly rather than a fixed table:

> "Minimum fitting height: |DN| + 2mm
> Minimum frame height: progression length + 10mm"

Where DN is the position of the near reference point below the centring
cross.

## Progression length and minimum fitting height

> "With the short progression, the design point near is –14 mm below the
> centering cross. In order to use the full addition, Rodenstock recommends
> a minimum fitting height of 16 mm... With the medium progression, the
> design point near is –16 mm below the centering cross. In order to use
> the full addition, Rodenstock recommends a minimum fitting height of
> 18 mm... With the long progression (L), the design point near is –18 mm
> below the centering cross. In order to use the full addition, Rodenstock
> recommends a minimum fitting height of 20 mm."
> — *Tips & Technology 2022*, chapter 1

## Application to this project

This project's `PROGRESSIVE_MIN_B_HEIGHT_MM` constant
(`app/lib/config/thresholds.ts`) is a **frame/B-height** constraint, not a
fitting-height constraint — it's checked against the catalog's
`lens_height_mm` column, which is the full vertical lens opening. Against
Rodenstock's own published range (23–36mm across their full product line,
with 24/26/28mm as the fixed S/M/L design-type values), a 32mm floor sits
inside the documented range, toward the higher end appropriate for
longer-corridor designs — not an arbitrary number, but also not
uniquely determined by this one source; see the OptiCampus and HOYA/Zeiss
documents in this corpus for corroborating figures.
