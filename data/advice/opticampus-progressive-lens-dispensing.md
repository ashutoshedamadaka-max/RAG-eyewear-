---
title: "Progressive lens dispensing — frame selection and fitting height practice"
source_org: OptiCampus (opti.vision), course author Darryl J Meister
source_document: "Progressive Lens Dispensing" (Module 10), copyright 2008
source_url: "https://opticampus.opti.vision/files/progressive_lens_dispensing.pdf"
claim_type: physical
verified: 2026-08-28
verification_method: "Downloaded PDF directly, decrypted (permissions-only encryption), extracted text with pypdf."
---

# Progressive lens dispensing — frame selection and fitting height

## Frame depth ("B") vs. fitting height

OptiCampus's course material draws the same distinction as Rodenstock's
documentation (see `rodenstock-frame-fitting-heights.md` in this corpus),
using the industry-standard "B" label for frame depth explicitly:

> "Ensure that the frame allows for the minimum fitting height of the lens
> design (e.g., 18 mm)
> Ensure that the frame allows for a sufficient amount of clearance above
> the fitting cross
> For most general purpose progressive lenses, a minimum depth of 25–30mm
> is recommended"
> — *Progressive Lens Dispensing*, "Ideal Frame Geometry" (repeated
> verbatim under "1. Select the Frame")

The accompanying diagram labels three distinct measurements on the frame:
**Fitting Height**, **Depth "B"**, and **Clearance** (the margin above the
fitting cross) — three different numbers, not one.

## Frame selection guidance

> "Select a well-fitting frame that maintains its adjustment
> Frames with adjustable nose pad (guard) arms will allow for small fitting
> height corrections later
> Large aviator-like styles will expose the wearer to regions of distortion
> that serve no visual purpose"
> — *Progressive Lens Dispensing*, "1. Select the Frame"

## Fitting height measurement practice

> "Ensure that you are at eye-level with the wearer
> Take monocular fitting height measurements
> ...
> Do not 'fudge' the fitting height measurement
> ...
> Ensure that the minimum fitting height is satisfied"
> — *Progressive Lens Dispensing*, "3. Measure the Fitting Heights"

On why under-measuring is a real, named failure mode, not a theoretical
one:

> "Dispensers may get into the habit of reducing fitting heights by 1 to
> 2 mm to improve wearer adaptation... 'fudging' the fitting heights in
> this manner will compromise near vision utility and overall performance."
> — *Progressive Lens Dispensing*, "Effect of 'Fudging' Fitting Heights"

And on measurement error from posture and parallax, both of which can move
a measurement by several millimetres — enough to cross a minimum-fitting-height
threshold:

> "Parallax error can significantly affect fitting height measurements —
> 1 inch of height difference = 1.7 mm of error"
> — *Progressive Lens Dispensing*, "Effect of Parallax Error"

## Application to this project

OptiCampus's "25–30mm" figure is explicitly a **frame depth (B)** figure,
using the same terminology this project now uses for
`PROGRESSIVE_MIN_B_HEIGHT_MM`. It is presented as a general-purpose
minimum, not the ceiling — Rodenstock's own longer-corridor and
near-comfort product lines go up to 28–34mm (see
`rodenstock-frame-fitting-heights.md`). A 32mm project floor is above
OptiCampus's general-purpose range but within the documented range for
longer-progression designs; that's a defensible, sourced position, not
an unsupported one — but it is a judgment call between two real sources
giving different numbers for different product tiers, not a single
resolved figure.
