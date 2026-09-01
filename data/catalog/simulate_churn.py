"""
Phase 7c (decisions.md, 2026-09-01): a plausible "next week" for the
catalog -- several real price changes (including one clearance discount
deliberately picked to test whether the titanium-under-INR-4,500 gap
survives ordinary churn, not avoiding the question), a few stock-outs,
some new frames (generated through the SAME seeded generator used for the
original 100, not hand-typed clones), and a couple of discontinuations
(removed from the catalog entirely, not just marked out of stock -- a
real SKU going away is a different event from a real SKU running low).

This is a measured experiment, not a hand-picked "safe" change -- the
whole point (per the instruction that prompted this) is to report
honestly whether anything breaks, not to engineer a churn that's
guaranteed not to.

Run: python simulate_churn.py
Writes: out/catalog.json (backed up first to out/catalog.pre-churn-2026-09-01.json)
        out/images/FR101.svg, FR102.svg, FR103.svg (new frames' real rendered images)
"""
import json
import os
import shutil
import random

import generate_catalog as gen
from render import render_frame

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
CATALOG_PATH = os.path.join(OUT, "catalog.json")
BACKUP_PATH = os.path.join(OUT, "catalog.pre-churn-2026-09-01.json")
IMG_DIR = os.path.join(OUT, "images")


def main():
    frames = json.load(open(CATALOG_PATH))
    by_id = {f["frame_id"]: f for f in frames}

    shutil.copy(CATALOG_PATH, BACKUP_PATH)
    print(f"Backed up pre-churn catalog to {BACKUP_PATH}")

    log = []

    # --- 1. Price changes (4) -- including one deliberately testing gap 3's survival
    price_changes = [
        ("FR100", 4600, 4200, "clearance -- deliberately tests whether the titanium <INR 4,500 gap survives ordinary churn"),
        ("FR001", 4800, 5100, "routine repricing, +6%"),
        ("FR013", 1150, 1050, "routine repricing, -9%"),
        ("FR033", 1150, 1250, "routine repricing, +9%"),
    ]
    for fid, expect_old, new_price, reason in price_changes:
        if fid not in by_id:
            print(f"  WARN: {fid} not found, skipping this price change")
            continue
        f = by_id[fid]
        if f["price_frame_only"] != expect_old:
            print(f"  WARN: {fid} price was {f['price_frame_only']}, expected {expect_old} -- applying anyway")
        old = f["price_frame_only"]
        f["price_frame_only"] = new_price
        f["price_band"] = gen.band_of(new_price) + 1
        log.append(f"price: {fid} {f['brand']} {f['model']} INR {old} -> {new_price} ({reason})")

    # --- 2. Stock-outs (4)
    in_stock_ids = [f["frame_id"] for f in frames if f["in_stock"]]
    random.seed(20260901)
    stockout_ids = random.sample(in_stock_ids, 4)
    for fid in stockout_ids:
        f = by_id[fid]
        f["in_stock"] = False
        f["stock_qty"] = 0
        f["stock_updated_at"] = "2026-09-01T09:00:00+05:30"
        log.append(f"stock-out: {fid} {f['brand']} {f['model']}")

    # --- 3. New frames (3), through the same seeded generator as the original 100
    next_idx = max(int(f["frame_id"][2:]) for f in frames) + 1
    new_specs = [("eyeglasses", 1), ("sunglasses", 2), ("computer", 0)]
    new_frames = []
    for ptype, band in new_specs:
        nf = gen.build_frame(next_idx, ptype, band)
        new_frames.append(nf)
        log.append(f"new: {nf['frame_id']} {nf['brand']} {nf['model']} ({ptype}, band {band + 1}, INR {nf['price_frame_only']})")
        next_idx += 1
    frames.extend(new_frames)

    # Render real images for the new frames (validate.py checks byte-uniqueness against these)
    os.makedirs(IMG_DIR, exist_ok=True)
    for nf in new_frames:
        svg = render_frame(nf)
        with open(os.path.join(IMG_DIR, f"{nf['frame_id']}.svg"), "w") as fh:
            fh.write(svg)

    # --- 4. Discontinued (2) -- removed entirely, not just marked out of stock.
    # Picked away from the price-change/stock-out IDs above so each churn event
    # stays independently attributable to one frame, not stacked on another.
    already_touched = {fid for fid, *_ in price_changes if fid} | set(stockout_ids)
    candidates = [f["frame_id"] for f in frames if f["frame_id"] not in already_touched]
    discontinued_ids = sorted(candidates)[:2]
    for fid in discontinued_ids:
        f = by_id[fid]
        log.append(f"discontinued: {fid} {f['brand']} {f['model']} -- removed from catalog")
    frames = [f for f in frames if f["frame_id"] not in discontinued_ids]

    json.dump(frames, open(CATALOG_PATH, "w"), indent=2)

    print(f"\n{len(frames)} frames after churn (was 100)")
    print("\n".join(f"  - {line}" for line in log))


if __name__ == "__main__":
    main()
