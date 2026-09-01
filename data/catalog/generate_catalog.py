"""
Generate a 100-frame synthetic eyewear catalog.

Synthetic by design: attributes are drawn from realistic distributions and
correlations, so the data supports every hard filter the conversation layer
produces. Documented as synthetic in the case study — no real product data.
"""

import json, os, random, hashlib
from collections import Counter, defaultdict

random.seed(1729)

BRANDS = ["Aeris", "Corvin", "Nira", "Vayu", "Meridian", "Kestrel", "Sable",
          "Halcyon", "Truss", "Lumen", "Orbit&Co", "Terra Optics", "Nyra",
          "Fathom", "Basalt", "Wren", "Sundial", "Quill"]

SUFFIX = ["Mark", "Line", "Series", "Edition", "Form", "Type"]

PRICE_BANDS = [(1000, 2500), (2500, 4500), (4500, 7000), (7000, 10000)]
BAND_TARGET = [25, 30, 28, 17]

TYPE_TARGET = {"eyeglasses": 45, "sunglasses": 25, "computer": 15, "reading": 15}

ALL_PURPOSES = ["everyday", "computer", "reading", "driving_day", "driving_night",
                "outdoor", "sports", "dust_travel", "formal_work"]

SHAPES = ["rectangle", "square", "round", "oval", "aviator", "cat_eye", "geometric"]

SHAPE_SUITS = {
    "rectangle": ["round", "oval", "heart"],
    "square":    ["round", "oval"],
    "round":     ["square", "rectangle", "heart"],
    "oval":      ["square", "rectangle", "heart"],
    "aviator":   ["square", "round", "oval", "heart"],
    "cat_eye":   ["round", "square", "oval"],
    "geometric": ["round", "oval"],
}

STYLE_BY_SHAPE = {
    "rectangle": ["professional", "minimal"],
    "square":    ["bold", "professional"],
    "round":     ["retro", "playful"],
    "oval":      ["minimal", "professional"],
    "aviator":   ["retro", "bold"],
    "cat_eye":   ["retro", "bold", "playful"],
    "geometric": ["bold", "playful"],
}

MATERIAL_COLORS = {
    "acetate":  ["midnight", "tortoise", "havana", "crystal", "burgundy",
                 "forest", "blush", "ink_blue"],
    "metal":    ["gold", "silver", "gunmetal", "rose_gold", "black_metal"],
    "titanium": ["matte_titanium", "navy_titanium", "bronze_ti", "silver"],
    "tr90":     ["matte_black", "matte_navy", "olive", "slate", "signal_red"],
}

TEMPLE_STYLES = ["plain", "tapered", "two_tone", "patterned"]


def band_of(price):
    for i, (lo, hi) in enumerate(PRICE_BANDS):
        if lo <= price < hi or (i == 3 and price <= hi):
            return i
    return 3


def pick_material(ptype, band):
    if ptype == "sports":
        return "tr90"
    if band == 0:
        return random.choices(["acetate", "tr90", "metal"], [0.45, 0.35, 0.20])[0]
    if band == 1:
        return random.choices(["acetate", "metal", "tr90"], [0.45, 0.35, 0.20])[0]
    if band == 2:
        return random.choices(["acetate", "metal", "titanium", "tr90"],
                              [0.35, 0.28, 0.27, 0.10])[0]
    return random.choices(["titanium", "acetate", "metal"], [0.52, 0.28, 0.20])[0]


def build_frame(idx, ptype, band, force_purpose=None):
    lo, hi = PRICE_BANDS[band]
    price = int(round(random.uniform(lo, hi) / 50) * 50)

    material = pick_material(ptype, band)
    # GAP 3: no titanium below band 2
    if material == "titanium" and band < 2:
        material = "metal"

    is_sun = ptype == "sunglasses"
    sporty = force_purpose == "sports"

    if sporty:
        shape = random.choice(["geometric", "square", "rectangle"])
        material = "tr90"
    elif is_sun:
        shape = random.choices(SHAPES, [0.14, 0.14, 0.12, 0.08, 0.26, 0.16, 0.10])[0]
    elif ptype == "reading":
        shape = random.choices(SHAPES, [0.34, 0.16, 0.20, 0.18, 0.02, 0.06, 0.04])[0]
    else:
        shape = random.choices(SHAPES, [0.28, 0.16, 0.16, 0.12, 0.08, 0.12, 0.08])[0]

    # --- measurements
    lens_width = random.randint(50, 60) if is_sun else random.randint(46, 56)
    bridge = random.randint(15, 22) if lens_width < 54 else random.randint(14, 19)
    temple = random.choice([135, 138, 140, 142, 145, 148])

    if is_sun:
        lens_height = random.randint(38, 50)
    elif ptype == "reading":
        lens_height = random.randint(26, 36)
    else:
        lens_height = random.randint(28, 44)
    if shape == "cat_eye":
        lens_height = max(lens_height, int(lens_width * 0.66))
    if shape == "round":
        lens_height = lens_width                      # circular by definition
    elif shape in ("square", "geometric"):
        lens_height = max(lens_height, int(lens_width * 0.82))
    if shape == "oval":
        lens_height = min(lens_height, int(lens_width * 0.70))
    lens_height = min(lens_height, 52)

    frame_width = 2 * lens_width + bridge + random.randint(4, 8)

    # --- rim type, correlated with material and purpose
    if sporty:
        rim = "full"
    elif material == "titanium":
        rim = random.choices(["full", "semi", "rimless"], [0.42, 0.28, 0.30])[0]
    elif material == "metal":
        rim = random.choices(["full", "semi", "rimless"], [0.62, 0.24, 0.14])[0]
    else:
        rim = random.choices(["full", "semi"], [0.88, 0.12])[0]
    if is_sun:
        rim = random.choices(["full", "semi"], [0.9, 0.1])[0]

    # --- weight, correlated with material and size
    base_w = {"acetate": 27, "metal": 20, "titanium": 15, "tr90": 18}[material]
    weight = base_w + (lens_width - 52) * 0.35 + random.uniform(-2.5, 2.5)
    if rim == "rimless":
        weight -= 4
    weight = round(max(11, min(38, weight)), 1)

    # --- prescription support
    if rim == "rimless":
        max_power = round(random.choice([3.5, 4.0, 4.0, 4.5]), 2)
    elif rim == "semi":
        max_power = round(random.choice([5.0, 6.0, 6.0, 6.5]), 2)
    else:
        max_power = round(random.choice([6.0, 8.0, 8.0, 10.0]), 2)

    wrap = random.choice([12, 14, 16]) if sporty else (
        random.choice([0, 0, 0, 6]) if is_sun else 0)
    if wrap >= 12:
        max_power = min(max_power, 2.0)   # wrap geometry limits Rx
        rx_compatible = False
    else:
        rx_compatible = ptype != "reading" or True

    progressive_ready = (lens_height >= 30 and rim != "rimless"
                         and ptype != "reading" and wrap < 12)
    if ptype == "reading":
        rx_compatible = False
    # GAP 2: no progressive-ready rimless — enforced by the line above

    nose_pad = ("adjustable" if material in ("metal", "titanium")
                else random.choices(["fixed_integrated", "silicone"],
                                    [0.72, 0.28])[0])
    if sporty:
        nose_pad = "silicone"

    # --- sunglass optics
    if is_sun or sporty:
        uv400 = True
        polarized = random.random() < (0.75 if band >= 2 else 0.35)
        tint = random.choice(["grey", "brown", "g15_green", "gradient",
                              "blue_mirror", "amber"])
        photochromic = random.random() < 0.18
    else:
        uv400 = random.random() < 0.25
        polarized = False
        tint = "none"
        photochromic = random.random() < 0.10

    # GAP 1: no polarized sports sunglasses under 2500
    if sporty and price < 2500:
        polarized = False

    blue_light = ptype == "computer" or (not is_sun and random.random() < 0.45)

    # --- purposes
    purposes = set()
    if force_purpose:
        purposes.add(force_purpose)
    if ptype == "eyeglasses":
        purposes.add("everyday")
        for p, w in [("formal_work", 0.45), ("computer", 0.35),
                     ("driving_night", 0.22), ("reading", 0.18)]:
            if random.random() < w:
                purposes.add(p)
    elif ptype == "computer":
        purposes.update(["computer", "everyday"])
        if random.random() < 0.4:
            purposes.add("formal_work")
    elif ptype == "reading":
        purposes.add("reading")
        if random.random() < 0.35:
            purposes.add("computer")
    else:  # sunglasses
        purposes.add("outdoor")
        for p, w in [("driving_day", 0.62), ("dust_travel", 0.34),
                     ("everyday", 0.30), ("sports", 0.10)]:
            if random.random() < w:
                purposes.add(p)
    if "driving_night" in purposes and tint != "none":
        purposes.discard("driving_night")
    if wrap >= 12:
        purposes.add("sports")

    face_fit = ("narrow" if frame_width < 128 else
                "wide" if frame_width > 141 else "medium")

    color = random.choice(MATERIAL_COLORS[material])
    temple_style = random.choice(TEMPLE_STYLES)
    if material in ("metal", "titanium"):
        temple_style = random.choice(["plain", "tapered", "two_tone"])

    brand = random.choice(BRANDS)
    model = f"{random.choice(SUFFIX)} {random.randint(100, 989)}"
    frame_id = f"FR{idx:03d}"

    row = {
        "frame_id": frame_id,
        "sku": f"{brand[:3].upper()}-{idx:03d}",
        "brand": brand,
        "model": model,
        "product_type": ptype,
        "shape": shape,
        "material": material,
        "rim_type": rim,
        "color": color,
        "color_family": color.split("_")[0],
        "temple_style": temple_style,

        "lens_width_mm": lens_width,
        "bridge_mm": bridge,
        "temple_mm": temple,
        "lens_height_mm": lens_height,
        "frame_width_mm": frame_width,
        "face_width_fit": face_fit,
        "weight_g": weight,

        "price_frame_only": price,
        "currency": "INR",
        "price_band": band + 1,

        "purpose_tags": sorted(purposes),
        "style_tags": sorted(set(STYLE_BY_SHAPE[shape] +
                                 (["sporty"] if wrap >= 12 else []))),
        "face_shape_suits": SHAPE_SUITS[shape],

        "rx_compatible": bool(rx_compatible and wrap < 12),
        "max_power_supported": max_power,
        "progressive_ready": progressive_ready,
        "nose_pad_type": nose_pad,
        "reading_power": (round(random.choice([1.0, 1.25, 1.5, 1.75, 2.0, 2.5]), 2)
                          if ptype == "reading" else None),

        "uv400": uv400,
        "polarized": polarized,
        "photochromic": photochromic,
        "tint_color": tint,
        "wrap_angle": wrap,
        "blue_light_ready": blue_light,

        "in_stock": random.random() < 0.88,
        "stock_qty": random.randint(0, 40),
        "source": "synthetic",
    }
    row["stock_updated_at"] = "2026-08-27T09:00:00+05:30"
    row["image_seed"] = hashlib.md5(
        f'{frame_id}{shape}{lens_width}{bridge}{lens_height}{rim}{color}{temple_style}'
        .encode()).hexdigest()[:12]
    row["content_hash"] = hashlib.md5(
        json.dumps({k: v for k, v in row.items()
                    if k not in ("in_stock", "stock_qty", "stock_updated_at")},
                   sort_keys=True).encode()).hexdigest()[:16]
    row["image_url"] = f"images/{frame_id}.svg"
    return row


def generate():
    plan = []
    for ptype, n in TYPE_TARGET.items():
        plan += [ptype] * n
    random.shuffle(plan)

    bands = []
    for i, n in enumerate(BAND_TARGET):
        bands += [i] * n
    random.shuffle(bands)

    # reading glasses skew cheap; titanium-heavy top band skews to eyeglasses
    pairs = []
    for ptype, band in zip(plan, bands):
        if ptype == "reading" and band == 3:
            band = random.choice([0, 1])
        pairs.append((ptype, band))

    # rebalance so band counts stay close to target
    counts = Counter(b for _, b in pairs)
    for i, (ptype, band) in enumerate(pairs):
        if counts[band] > BAND_TARGET[band] and ptype != "reading":
            for cand in range(4):
                if counts[cand] < BAND_TARGET[cand]:
                    counts[band] -= 1
                    counts[cand] += 1
                    pairs[i] = (ptype, cand)
                    break

    # designate 5 true sports frames, one per band plus a spare, so wrap
    # geometry and its Rx consequences actually exist in the data
    sun_idx = [i for i, (t, _) in enumerate(pairs) if t == "sunglasses"]
    random.shuffle(sun_idx)
    sports_slots, used_bands = set(), set()
    for i in sun_idx:
        b = pairs[i][1]
        if b not in used_bands:
            sports_slots.add(i); used_bands.add(b)
        if len(used_bands) == 4:
            break
    sports_slots.add(next(i for i in sun_idx if i not in sports_slots))

    frames = []
    for i, (ptype, band) in enumerate(pairs, start=1):
        fp = "sports" if (i - 1) in sports_slots else None
        frames.append(build_frame(i, ptype, band, force_purpose=fp))

    # --- coverage repair: every purpose needs >= 4 frames across >= 3 bands
    for purpose in ALL_PURPOSES:
        for _ in range(60):
            have = [f for f in frames if purpose in f["purpose_tags"]]
            bands_seen = {f["price_band"] for f in have}
            if len(have) >= 4 and len(bands_seen) >= 3:
                break
            missing_band = next((b for b in (1, 2, 3, 4) if b not in bands_seen), None)
            pool = [f for f in frames
                    if purpose not in f["purpose_tags"]
                    and (missing_band is None or f["price_band"] == missing_band)
                    and _purpose_compatible(f, purpose)]
            if not pool:
                pool = [f for f in frames if purpose not in f["purpose_tags"]
                        and _purpose_compatible(f, purpose)]
            if not pool:
                break
            t = random.choice(pool)
            t["purpose_tags"] = sorted(set(t["purpose_tags"] + [purpose]))

    return frames


def _purpose_compatible(f, purpose):
    """Don't tag a frame with a purpose its physics contradicts."""
    if purpose in ("outdoor", "driving_day", "dust_travel"):
        return f["product_type"] == "sunglasses"
    if purpose == "driving_night":
        return f["tint_color"] == "none"
    if purpose == "sports":
        return f["material"] == "tr90"
    if purpose == "reading":
        return f["product_type"] in ("reading", "eyeglasses")
    if purpose == "computer":
        return f["product_type"] in ("computer", "eyeglasses", "reading")
    if purpose == "formal_work":
        return f["product_type"] != "sunglasses"
    return f["product_type"] != "sunglasses"


if __name__ == "__main__":
    from render import render_frame

    # Relative to this file, not the cloud-sandbox path this script was
    # originally authored in (/home/claude/eyewear/out) -- fixed 2026-09-01
    # (decisions.md, Phase 7) so this script and validate.py actually run
    # against this repo's real layout (data/catalog/out/) instead of a path
    # that only ever existed in the environment that first wrote this file.
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
    img_dir = os.path.join(out_dir, "images")
    os.makedirs(img_dir, exist_ok=True)

    frames = generate()

    seen = {}
    for f in frames:
        svg = render_frame(f)
        h = hashlib.md5(svg.encode()).hexdigest()
        if h in seen:
            raise SystemExit(f"DUPLICATE IMAGE: {f['frame_id']} == {seen[h]}")
        seen[h] = f["frame_id"]
        with open(os.path.join(img_dir, f"{f['frame_id']}.svg"), "w") as fh:
            fh.write(svg)

    with open(os.path.join(out_dir, "catalog.json"), "w") as fh:
        json.dump(frames, fh, indent=2)

    print(f"{len(frames)} frames, {len(seen)} unique images")
