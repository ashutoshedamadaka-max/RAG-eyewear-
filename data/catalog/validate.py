"""Validate the generated catalog against the composition contract."""

import json, hashlib, os
from collections import Counter, defaultdict

ALL_PURPOSES = ["everyday", "computer", "reading", "driving_day", "driving_night",
                "outdoor", "sports", "dust_travel", "formal_work"]

import sys

# Relative to this file (2026-09-01, decisions.md, Phase 7) -- see the same
# fix in generate_catalog.py for why. An optional CLI arg overrides the
# catalog path so this can validate a churned/simulated variant without
# touching the real out/catalog.json.
_HERE = os.path.dirname(os.path.abspath(__file__))
_catalog_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(_HERE, "out", "catalog.json")
_img_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(_HERE, "out", "images")

frames = json.load(open(_catalog_path))
img_dir = _img_dir
fails, warns, notes = [], [], []


def check(cond, msg):
    (notes if cond else fails).append(("PASS" if cond else "FAIL", msg))


# --- counts
check(len(frames) == 100, f"100 frames (got {len(frames)})")
tc = Counter(f["product_type"] for f in frames)
check(dict(tc) == {"eyeglasses": 45, "sunglasses": 25, "computer": 15, "reading": 15},
      f"type mix 45/25/15/15 (got {dict(tc)})")

bc = Counter(f["price_band"] for f in frames)
check(all(abs(bc[i + 1] - t) <= 4 for i, t in enumerate([25, 30, 28, 17])),
      f"price bands within tolerance of 25/30/28/17 (got {dict(sorted(bc.items()))})")
check(all(1000 <= f["price_frame_only"] <= 10000 for f in frames),
      "all prices within INR 1,000-10,000")

# --- images unique
hashes = {}
dupes = []
for f in frames:
    p = os.path.join(img_dir, f"{f['frame_id']}.svg")
    h = hashlib.md5(open(p, "rb").read()).hexdigest()
    if h in hashes:
        dupes.append((f["frame_id"], hashes[h]))
    hashes[h] = f["frame_id"]
check(not dupes, f"all images byte-unique ({len(hashes)} distinct of {len(frames)} frames)")
check(len({f["image_seed"] for f in frames}) == len(frames),
      f"all image_seeds unique ({len({f['image_seed'] for f in frames})} distinct of {len(frames)} frames)")

# --- purpose coverage
cov = defaultdict(lambda: defaultdict(int))
for f in frames:
    for p in f["purpose_tags"]:
        cov[p][f["price_band"]] += 1
for p in ALL_PURPOSES:
    n = sum(cov[p].values())
    b = len(cov[p])
    check(n >= 4 and b >= 3, f"purpose '{p}': {n} frames across {b} price bands (need >=4, >=3)")

# --- physical correctness invariants
for f in frames:
    if f["progressive_ready"]:
        if f["lens_height_mm"] < 30:
            fails.append(("FAIL", f"{f['frame_id']} progressive_ready with lens_height {f['lens_height_mm']}"))
        if f["rim_type"] == "rimless":
            fails.append(("FAIL", f"{f['frame_id']} progressive_ready AND rimless"))
    if f["rim_type"] == "rimless" and f["max_power_supported"] > 4.5:
        fails.append(("FAIL", f"{f['frame_id']} rimless supports {f['max_power_supported']}D"))
    if f["tint_color"] != "none" and "driving_night" in f["purpose_tags"]:
        fails.append(("FAIL", f"{f['frame_id']} tinted but tagged driving_night"))
    if f["product_type"] == "sunglasses" and not f["uv400"]:
        fails.append(("FAIL", f"{f['frame_id']} sunglasses without UV400"))
    if f["product_type"] == "reading" and f["reading_power"] is None:
        fails.append(("FAIL", f"{f['frame_id']} reading glasses without reading_power"))
    if f["wrap_angle"] >= 12 and f["rx_compatible"]:
        fails.append(("FAIL", f"{f['frame_id']} high wrap but rx_compatible"))
check(True, "physical invariants evaluated")

# --- correlations
ti = [f["price_frame_only"] for f in frames if f["material"] == "titanium"]
ac = [f["price_frame_only"] for f in frames if f["material"] == "acetate"]
check(sum(ti) / len(ti) > sum(ac) / len(ac),
      f"titanium priced above acetate (avg INR {sum(ti)//len(ti)} vs {sum(ac)//len(ac)})")
tw = [f["weight_g"] for f in frames if f["material"] == "titanium"]
aw = [f["weight_g"] for f in frames if f["material"] == "acetate"]
check(sum(tw) / len(tw) < sum(aw) / len(aw),
      f"titanium lighter than acetate (avg {sum(tw)/len(tw):.1f}g vs {sum(aw)/len(aw):.1f}g)")

# --- intentional gaps (these SHOULD be empty)
gaps = {
    "polarised sports sunglasses under INR 2,500":
        [f for f in frames if f["polarized"] and "sports" in f["purpose_tags"]
         and f["price_frame_only"] < 2500],
    "progressive-ready rimless frames":
        [f for f in frames if f["progressive_ready"] and f["rim_type"] == "rimless"],
    "titanium frames under INR 4,500":
        [f for f in frames if f["material"] == "titanium" and f["price_frame_only"] < 4500],
}

print("=" * 68)
print("CATALOG VALIDATION")
print("=" * 68)
for status, msg in notes + fails:
    print(f"  [{status}] {msg}")
print()
print("INTENTIONAL GAPS (drive the relaxation-ladder demo)")
for label, hits in gaps.items():
    print(f"  [{'OK — empty' if not hits else f'LEAKED {len(hits)}'}] {label}")
print()
print(f"in stock: {sum(f['in_stock'] for f in frames)}/100")
print(f"shapes:   {dict(Counter(f['shape'] for f in frames))}")
print(f"materials:{dict(Counter(f['material'] for f in frames))}")
print(f"rim types:{dict(Counter(f['rim_type'] for f in frames))}")
print(f"rx-compatible: {sum(f['rx_compatible'] for f in frames)}  "
      f"progressive-ready: {sum(f['progressive_ready'] for f in frames)}")
print()
print("PURPOSE COVERAGE (frames per price band 1-4)")
for p in ALL_PURPOSES:
    row = " ".join(f"b{b}:{cov[p].get(b,0):<3}" for b in (1, 2, 3, 4))
    print(f"  {p:<14} total {sum(cov[p].values()):<3} {row}")
print()
print(f"RESULT: {len(fails)} failures")
