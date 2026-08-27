"""
Parametric SVG renderer for eyewear frames.

Every visual property is derived from the frame's own attributes, so an image
can never contradict its spec row. Two frames with identical shape/size still
render distinctly because temple_style, colour and finish also vary.
"""

import hashlib

PX_PER_MM = 2.35
VB_W, VB_H = 480, 246
CX, CY = 240, 108

# ---------------------------------------------------------------- palettes

COLORS = {
    # acetate — deep, saturated, with visible material character
    "midnight":      {"base": "#1B1D22", "shade": "#0E0F12", "light": "#3A3D45"},
    "tortoise":      {"base": "#8A5A2B", "shade": "#4A2E14", "light": "#C08A4A"},
    "havana":        {"base": "#6B4226", "shade": "#3E2413", "light": "#A6703F"},
    "crystal":       {"base": "#C7CDD2", "shade": "#9AA3AA", "light": "#E8ECEF"},
    "burgundy":      {"base": "#5C1F2E", "shade": "#33101A", "light": "#8E3A4C"},
    "forest":        {"base": "#2C4033", "shade": "#17251B", "light": "#4C6B56"},
    "blush":         {"base": "#C2908C", "shade": "#8E625E", "light": "#DFB8B4"},
    "ink_blue":      {"base": "#22314A", "shade": "#131C2C", "light": "#3E5578"},
    # metal
    "gold":          {"base": "#C4A052", "shade": "#8A6E2E", "light": "#E4CB8A"},
    "silver":        {"base": "#B4BABF", "shade": "#7E858B", "light": "#DDE2E5"},
    "gunmetal":      {"base": "#4B5157", "shade": "#2C3136", "light": "#6E767D"},
    "rose_gold":     {"base": "#BC8878", "shade": "#8A5E50", "light": "#DDB0A2"},
    "black_metal":   {"base": "#2A2C2F", "shade": "#151618", "light": "#4A4D51"},
    # titanium
    "matte_titanium": {"base": "#7C848B", "shade": "#565D63", "light": "#A2A9AF"},
    "navy_titanium":  {"base": "#2E3C4E", "shade": "#1A222D", "light": "#4C5F76"},
    "bronze_ti":      {"base": "#8A6A4B", "shade": "#5E4630", "light": "#B08D68"},
    # TR90 / nylon — matte
    "matte_black":   {"base": "#26292C", "shade": "#141618", "light": "#3E4245"},
    "matte_navy":    {"base": "#1F2B3A", "shade": "#111925", "light": "#374A61"},
    "olive":         {"base": "#454C33", "shade": "#282D1D", "light": "#666F4E"},
    "slate":         {"base": "#565D64", "shade": "#383D42", "light": "#787F86"},
    "signal_red":    {"base": "#8E2B24", "shade": "#5C1815", "light": "#B84C42"},
}

MATERIAL_COLORS = {
    "acetate":  ["midnight", "tortoise", "havana", "crystal", "burgundy",
                 "forest", "blush", "ink_blue"],
    "metal":    ["gold", "silver", "gunmetal", "rose_gold", "black_metal"],
    "titanium": ["matte_titanium", "navy_titanium", "bronze_ti", "silver"],
    "tr90":     ["matte_black", "matte_navy", "olive", "slate", "signal_red"],
}

TINTS = {
    "none":        None,
    "grey":        ("#4A4F55", 0.62),
    "brown":       ("#5A3A20", 0.60),
    "g15_green":   ("#2E4034", 0.60),
    "blue_mirror": ("#2A4C7A", 0.58),
    "gradient":    ("#3A3F46", 0.55),
    "amber":       ("#8A5A1E", 0.42),
}


# ---------------------------------------------------------------- geometry

def _rrect(cx, cy, w, h, r):
    x0, y0, x1, y1 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
    r = min(r, w / 2, h / 2)
    return (f"M {x0+r:.1f} {y0:.1f} L {x1-r:.1f} {y0:.1f} "
            f"Q {x1:.1f} {y0:.1f} {x1:.1f} {y0+r:.1f} "
            f"L {x1:.1f} {y1-r:.1f} Q {x1:.1f} {y1:.1f} {x1-r:.1f} {y1:.1f} "
            f"L {x0+r:.1f} {y1:.1f} Q {x0:.1f} {y1:.1f} {x0:.1f} {y1-r:.1f} "
            f"L {x0:.1f} {y0+r:.1f} Q {x0:.1f} {y0:.1f} {x0+r:.1f} {y0:.1f} Z")


def _ellipse(cx, cy, w, h):
    rx, ry = w / 2, h / 2
    return (f"M {cx-rx:.1f} {cy:.1f} "
            f"A {rx:.1f} {ry:.1f} 0 0 1 {cx+rx:.1f} {cy:.1f} "
            f"A {rx:.1f} {ry:.1f} 0 0 1 {cx-rx:.1f} {cy:.1f} Z")


def _outer_inner(cx, cy, w, h, side):
    """Return X(t), Y(u) where t runs 0=outer edge -> 1=inner edge.

    Writing shapes in this space means the same control points produce a
    correctly mirrored lens on either side, with no sign juggling.
    """
    s = -1 if side == "left" else 1
    xo, xi = cx + s * w / 2, cx - s * w / 2
    y0 = cy - h / 2
    return (lambda t: xo + (xi - xo) * t), (lambda u: y0 + h * u)


def _aviator(cx, cy, w, h, side):
    """Teardrop: broad top, soft point dropping toward the nose side."""
    X, Y = _outer_inner(cx, cy, w, h, side)
    return (f"M {X(0.12):.1f} {Y(0.07):.1f} "
            f"Q {X(0.20):.1f} {Y(0.0):.1f} {X(0.40):.1f} {Y(0.0):.1f} "
            f"L {X(0.88):.1f} {Y(0.0):.1f} "
            f"Q {X(1.0):.1f} {Y(0.02):.1f} {X(1.0):.1f} {Y(0.26):.1f} "
            f"Q {X(1.0):.1f} {Y(0.70):.1f} {X(0.62):.1f} {Y(0.99):.1f} "
            f"Q {X(0.40):.1f} {Y(1.09):.1f} {X(0.18):.1f} {Y(0.82):.1f} "
            f"Q {X(0.02):.1f} {Y(0.58):.1f} {X(0.02):.1f} {Y(0.30):.1f} "
            f"Q {X(0.02):.1f} {Y(0.13):.1f} {X(0.12):.1f} {Y(0.07):.1f} Z")


def _cat_eye(cx, cy, w, h, side):
    """Full rounded bottom with an upswept outer top corner."""
    X, Y = _outer_inner(cx, cy, w, h, side)
    return (f"M {X(1.0):.1f} {Y(0.30):.1f} "
            f"Q {X(1.0):.1f} {Y(0.10):.1f} {X(0.82):.1f} {Y(0.12):.1f} "
            f"Q {X(0.44):.1f} {Y(0.06):.1f} {X(0.16):.1f} {Y(0.0):.1f} "
            f"Q {X(0.0):.1f} {Y(-0.02):.1f} {X(0.01):.1f} {Y(0.24):.1f} "
            f"Q {X(0.02):.1f} {Y(0.80):.1f} {X(0.34):.1f} {Y(1.0):.1f} "
            f"Q {X(0.68):.1f} {Y(1.05):.1f} {X(0.92):.1f} {Y(0.74):.1f} "
            f"Q {X(1.0):.1f} {Y(0.62):.1f} {X(1.0):.1f} {Y(0.30):.1f} Z")


def _rounded_poly(pts, r):
    """Polygon with quadratic-rounded corners."""
    n = len(pts)
    d = []
    for i in range(n):
        x0, y0 = pts[i - 1]
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        for (ax, ay), (bx, by), lead in (((x0, y0), (x1, y1), True),
                                         ((x2, y2), (x1, y1), False)):
            pass
        def toward(px, py, qx, qy, dist):
            vx, vy = qx - px, qy - py
            L = max((vx * vx + vy * vy) ** 0.5, 1e-6)
            f = min(dist / L, 0.45)
            return px + vx * f, py + vy * f
        ax, ay = toward(x1, y1, x0, y0, r)
        bx, by = toward(x1, y1, x2, y2, r)
        d.append((f"M {ax:.1f} {ay:.1f} " if i == 0 else f"L {ax:.1f} {ay:.1f} ")
                 + f"Q {x1:.1f} {y1:.1f} {bx:.1f} {by:.1f} ")
    return "".join(d) + "Z"


def _hexagon(cx, cy, w, h):
    dx, dy = w / 2, h / 2
    k = w * 0.26
    pts = [(cx - dx + k, cy - dy), (cx + dx - k, cy - dy), (cx + dx, cy),
           (cx + dx - k, cy + dy), (cx - dx + k, cy + dy), (cx - dx, cy)]
    return _rounded_poly(pts, w * 0.09)


def lens_path(shape, cx, cy, w, h, side):
    if shape == "rectangle":
        return _rrect(cx, cy, w, h, min(w, h) * 0.22)
    if shape == "square":
        return _rrect(cx, cy, w, h, min(w, h) * 0.13)
    if shape in ("round", "oval"):
        return _ellipse(cx, cy, w, h)
    if shape == "aviator":
        return _aviator(cx, cy, w, h, side)
    if shape == "cat_eye":
        return _cat_eye(cx, cy, w, h, side)
    if shape == "geometric":
        return _hexagon(cx, cy, w, h)
    return _rrect(cx, cy, w, h, min(w, h) * 0.2)


# ---------------------------------------------------------------- renderer


# ---------------------------------------------------------------- renderer

def render_frame(f, background=True):
    """Studio-style product illustration derived entirely from the spec row."""
    from xml.sax.saxutils import escape as _esc

    lw = f["lens_width_mm"] * PX_PER_MM
    lh = f["lens_height_mm"] * PX_PER_MM
    br = f["bridge_mm"] * PX_PER_MM
    lx, rx = CX - br / 2 - lw / 2, CX + br / 2 + lw / 2

    pal = COLORS[f["color"]]
    rim, mat, uid = f["rim_type"], f["material"], f["frame_id"]
    metal_like = mat in ("metal", "titanium")
    glossy = mat in ("acetate", "metal", "titanium")

    rim_w = 2.6 if metal_like else (8.0 if mat == "acetate" else 6.6)
    if rim == "semi":
        rim_w = max(rim_w, 7.0)
    bevel = rim_w * 0.30

    tint = TINTS.get(f.get("tint_color", "none"))
    label = _esc(f'{f["brand"]} {f["model"]}, {f["shape"].replace("_"," ")} '
                 f'{rim}-rim {mat} frame in {f["color"].replace("_"," ")}')

    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VB_W} {VB_H}" '
         f'width="{VB_W}" height="{VB_H}" role="img" aria-label="{label}">']

    d = ['<defs>']
    # studio backdrop
    d.append('<linearGradient id="bg%s" x1="0" y1="0" x2="0" y2="1">'
             '<stop offset="0%%" stop-color="#FDFDFE"/>'
             '<stop offset="62%%" stop-color="#F1F4F6"/>'
             '<stop offset="100%%" stop-color="#E6EBEE"/></linearGradient>' % uid)
    d.append(f'<radialGradient id="key{uid}" cx="0.5" cy="0.34" r="0.62">'
             f'<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.95"/>'
             f'<stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>'
             f'</radialGradient>')
    # frame body: top-lit
    d.append(f'<linearGradient id="g{uid}" x1="0.15" y1="0" x2="0.55" y2="1">'
             f'<stop offset="0%" stop-color="{pal["light"]}"/>'
             f'<stop offset="30%" stop-color="{pal["base"]}"/>'
             f'<stop offset="78%" stop-color="{pal["base"]}"/>'
             f'<stop offset="100%" stop-color="{pal["shade"]}"/></linearGradient>')
    # lens body
    if tint:
        c, op = tint
        if f.get("tint_color") == "gradient":
            d.append(f'<linearGradient id="t{uid}" x1="0" y1="0" x2="0" y2="1">'
                     f'<stop offset="0%" stop-color="{c}" stop-opacity="{op:.2f}"/>'
                     f'<stop offset="100%" stop-color="{c}" stop-opacity="{op*0.22:.2f}"/>'
                     f'</linearGradient>')
        else:
            d.append(f'<linearGradient id="t{uid}" x1="0.1" y1="0" x2="0.75" y2="1">'
                     f'<stop offset="0%" stop-color="{c}" stop-opacity="{min(op+0.14,0.92):.2f}"/>'
                     f'<stop offset="55%" stop-color="{c}" stop-opacity="{op:.2f}"/>'
                     f'<stop offset="100%" stop-color="{c}" stop-opacity="{max(op-0.12,0.3):.2f}"/>'
                     f'</linearGradient>')
        lens_fill = f'url(#t{uid})'
    else:
        d.append(f'<linearGradient id="t{uid}" x1="0.15" y1="0" x2="0.7" y2="1">'
                 f'<stop offset="0%" stop-color="#E9EFF4"/>'
                 f'<stop offset="46%" stop-color="#D7E1E9"/>'
                 f'<stop offset="100%" stop-color="#C6D3DD"/></linearGradient>')
        lens_fill = f'url(#t{uid})'

    # specular streak across the glass
    d.append(f'<linearGradient id="sp{uid}" x1="0" y1="0" x2="1" y2="1">'
             f'<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0"/>'
             f'<stop offset="42%" stop-color="#FFFFFF" stop-opacity="0.60"/>'
             f'<stop offset="58%" stop-color="#FFFFFF" stop-opacity="0.60"/>'
             f'<stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>'
             f'</linearGradient>')
    d.append(f'<filter id="blur{uid}"><feGaussianBlur stdDeviation="3.2"/></filter>')
    d.append(f'<filter id="soft{uid}" x="-30%" y="-40%" width="160%" height="200%">'
             f'<feGaussianBlur stdDeviation="7"/></filter>')

    if f["color"] in ("tortoise", "havana"):
        d.append(f'<pattern id="p{uid}" width="30" height="30" '
                 f'patternUnits="userSpaceOnUse" patternTransform="rotate(22)">'
                 f'<rect width="30" height="30" fill="{pal["base"]}"/>'
                 f'<ellipse cx="7" cy="8" rx="6.2" ry="3.6" fill="{pal["shade"]}" opacity="0.9"/>'
                 f'<ellipse cx="22" cy="20" rx="7.0" ry="4.0" fill="{pal["shade"]}" opacity="0.75"/>'
                 f'<ellipse cx="16" cy="3" rx="3.6" ry="2.2" fill="{pal["light"]}" opacity="0.6"/>'
                 f'<ellipse cx="3" cy="23" rx="3.2" ry="2.1" fill="{pal["light"]}" opacity="0.5"/>'
                 f'</pattern>')
        body = f'url(#p{uid})'
    else:
        body = f'url(#g{uid})'

    paths = {s: lens_path(f["shape"], cx_, CY, lw, lh, s)
             for s, cx_ in (("left", lx), ("right", rx))}
    for s in ("left", "right"):
        d.append(f'<clipPath id="lc{uid}{s}"><path d="{paths[s]}"/></clipPath>')
    if rim == "semi":
        d.append(f'<clipPath id="c{uid}">'
                 f'<rect x="0" y="{CY-lh/2-16:.1f}" width="{VB_W}" height="{lh*0.5+16:.1f}"/>'
                 f'</clipPath>')
    d.append('</defs>')
    o.append("".join(d))

    if background:
        o.append(f'<rect width="{VB_W}" height="{VB_H}" rx="16" fill="url(#bg{uid})"/>')
        o.append(f'<rect width="{VB_W}" height="{VB_H}" rx="16" fill="url(#key{uid})"/>')

    # contact shadow on the surface
    o.append(f'<ellipse cx="{CX}" cy="{CY+lh*0.62+16:.1f}" rx="{lw*1.35:.1f}" '
             f'ry="{max(9, lh*0.10):.1f}" fill="#0A1620" opacity="0.16" '
             f'filter="url(#soft{uid})"/>')

    def stroked(path, w, fill, dark=True):
        """Rim with a top bevel highlight and an underside shadow line."""
        out = []
        if dark:
            out.append(f'<g transform="translate(0 {bevel*0.9:.2f})">'
                       f'<path d="{path}" fill="none" stroke="{pal["shade"]}" '
                       f'stroke-width="{w:.1f}" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/></g>')
        out.append(f'<path d="{path}" fill="none" stroke="{fill}" '
                   f'stroke-width="{w:.1f}" stroke-linejoin="round" stroke-linecap="round"/>')
        out.append(f'<g transform="translate(0 {-bevel:.2f})">'
                   f'<path d="{path}" fill="none" stroke="{pal["light"]}" '
                   f'stroke-width="{w*0.30:.1f}" stroke-linejoin="round" stroke-linecap="round" '
                   f'opacity="{0.55 if glossy else 0.28:.2f}"/></g>')
        return "".join(out)

    # ---- temples: taper out and back, with a rounded tip
    tstyle = f.get("temple_style", "plain")
    for side, ex in (("left", lx - lw / 2), ("right", rx + lw / 2)):
        s = -1 if side == "left" else 1
        hx, hy = ex - s * 3, CY - lh * 0.14
        tipx, tipy = ex + s * 56, hy + 21
        tw = 10.0 if mat == "acetate" else (4.2 if metal_like else 8.6)
        tipw = tw * (0.40 if tstyle == "tapered" else 0.62)
        mx, my = (hx + tipx) / 2, (hy + tipy) / 2 + 2
        arm = (f"M {hx:.1f} {hy-tw/2:.1f} "
               f"Q {mx:.1f} {my-tw*0.50:.1f} {tipx:.1f} {tipy-tipw/2:.1f} "
               f"Q {tipx+s*tipw*0.7:.1f} {tipy:.1f} {tipx:.1f} {tipy+tipw/2:.1f} "
               f"Q {mx:.1f} {my+tw*0.50:.1f} {hx:.1f} {hy+tw/2:.1f} Z")
        o.append(f'<path d="{arm}" fill="{body}"/>')
        o.append(f'<path d="{arm}" fill="none" stroke="{pal["shade"]}" '
                 f'stroke-width="0.9" opacity="0.75"/>')
        # top-edge highlight along the arm
        o.append(f'<path d="M {hx:.1f} {hy-tw*0.34:.1f} Q {mx:.1f} {my-tw*0.30:.1f} '
                 f'{tipx:.1f} {tipy-tipw*0.30:.1f}" fill="none" '
                 f'stroke="{pal["light"]}" stroke-width="{tw*0.18:.1f}" '
                 f'opacity="{0.5 if glossy else 0.25:.2f}" stroke-linecap="round"/>')
        if tstyle == "two_tone":
            o.append(f'<path d="M {mx:.1f} {my-tw*0.40:.1f} '
                     f'Q {(mx+tipx)/2:.1f} {(my+tipy)/2-tipw*0.5:.1f} '
                     f'{tipx:.1f} {tipy-tipw/2:.1f} '
                     f'Q {tipx+s*tipw*0.7:.1f} {tipy:.1f} {tipx:.1f} {tipy+tipw/2:.1f} '
                     f'Q {(mx+tipx)/2:.1f} {(my+tipy)/2+tipw*0.5:.1f} '
                     f'{mx:.1f} {my+tw*0.45:.1f} Z" fill="{pal["light"]}" opacity="0.82"/>')
        if tstyle == "patterned":
            for i in range(3):
                k = 0.30 + i * 0.16
                o.append(f'<circle cx="{hx+(tipx-hx)*k:.1f}" cy="{hy+(tipy-hy)*k-1:.1f}" '
                         f'r="1.9" fill="{pal["light"]}" opacity="0.9"/>')
        # hinge barrel
        o.append(f'<rect x="{hx-s*2.5-2.4:.1f}" y="{hy-tw*0.52:.1f}" width="5.0" '
                 f'height="{tw*1.04:.1f}" rx="2.2" fill="{pal["base"]}" '
                 f'stroke="{pal["shade"]}" stroke-width="0.7" opacity="0.95"/>')
        o.append(f'<circle cx="{hx-s*0.5:.1f}" cy="{hy:.1f}" r="1.5" '
                 f'fill="{pal["light"]}" opacity="0.85"/>')

    # ---- bridge
    bh = min(lh * (0.115 if f["shape"] != "aviator" else 0.085), 13)
    by = CY - lh * (0.18 if f["shape"] != "aviator" else 0.30)
    if metal_like:
        for dy_, col, wdt, opa in ((bevel*0.9, pal["shade"], rim_w+0.8, 0.85),
                                   (0, pal["base"], rim_w+0.8, 1),
                                   (-bevel, pal["light"], (rim_w+0.8)*0.32, 0.55)):
            o.append(f'<g transform="translate(0 {dy_:.2f})">'
                     f'<path d="M {lx+lw/2-9:.1f} {by:.1f} Q {CX:.1f} {by-bh*1.5:.1f} '
                     f'{rx-lw/2+9:.1f} {by:.1f}" fill="none" stroke="{col}" '
                     f'stroke-width="{wdt:.1f}" stroke-linecap="round" '
                     f'opacity="{opa}"/></g>')
        if f["shape"] == "aviator":
            o.append(f'<path d="M {lx+lw/2-9:.1f} {by+10:.1f} Q {CX:.1f} {by+3:.1f} '
                     f'{rx-lw/2+9:.1f} {by+10:.1f}" fill="none" stroke="{pal["base"]}" '
                     f'stroke-width="{rim_w:.1f}" stroke-linecap="round"/>')
    else:
        bp = (f"M {lx+lw/2-9:.1f} {by-bh/2:.1f} L {rx-lw/2+9:.1f} {by-bh/2:.1f} "
              f"L {rx-lw/2+9:.1f} {by+bh/2:.1f} Q {CX:.1f} {by+bh*0.95:.1f} "
              f"{lx+lw/2-9:.1f} {by+bh/2:.1f} Z")
        o.append(f'<path d="{bp}" fill="{body}" stroke="{pal["shade"]}" stroke-width="0.9"/>')
        o.append(f'<path d="M {lx+lw/2-6:.1f} {by-bh*0.30:.1f} '
                 f'L {rx-lw/2+6:.1f} {by-bh*0.30:.1f}" stroke="{pal["light"]}" '
                 f'stroke-width="{bh*0.22:.1f}" opacity="0.45" stroke-linecap="round"/>')

    # ---- nose pads
    if f.get("nose_pad_type") in ("adjustable", "silicone"):
        for s in (-1, 1):
            px = CX + s * (br * 0.30 + 3)
            if metal_like:
                o.append(f'<line x1="{CX + s*(br*0.16):.1f}" y1="{by+4:.1f}" '
                         f'x2="{px:.1f}" y2="{CY+lh*0.05:.1f}" stroke="{pal["base"]}" '
                         f'stroke-width="1.6" stroke-linecap="round"/>')
            o.append(f'<g transform="rotate({s*15} {px:.1f} {CY+lh*0.13:.1f})">'
                     f'<rect x="{px-2.9:.1f}" y="{CY+lh*0.02:.1f}" width="5.8" '
                     f'height="13" rx="2.9" fill="#EDF2F6" stroke="#B4C0C9" '
                     f'stroke-width="0.7"/>'
                     f'<rect x="{px-1.6:.1f}" y="{CY+lh*0.02+2:.1f}" width="1.8" '
                     f'height="7" rx="0.9" fill="#FFFFFF" opacity="0.8"/></g>')

    # ---- lenses
    for side, ccx in (("left", lx), ("right", rx)):
        p = paths[side]
        o.append(f'<path d="{p}" fill="{lens_fill}"/>')
        # inner shading against the rim
        o.append(f'<g clip-path="url(#lc{uid}{side})">'
                 f'<path d="{p}" fill="none" stroke="#0F2430" stroke-width="{lw*0.16:.1f}" '
                 f'opacity="0.16" filter="url(#blur{uid})"/></g>')
        # specular streak
        x0, y0 = ccx - lw * 0.62, CY - lh * 0.75
        o.append(f'<g clip-path="url(#lc{uid}{side})">'
                 f'<path d="M {x0:.1f} {y0+lh*0.42:.1f} L {x0+lw*0.52:.1f} {y0:.1f} '
                 f'L {x0+lw*0.78:.1f} {y0:.1f} L {x0+lw*0.26:.1f} {y0+lh*0.42:.1f} Z" '
                 f'fill="url(#sp{uid})" opacity="0.75"/>'
                 f'<path d="M {x0+lw*0.60:.1f} {y0+lh*1.6:.1f} '
                 f'L {x0+lw*1.02:.1f} {y0+lh*1.26:.1f} L {x0+lw*1.12:.1f} {y0+lh*1.26:.1f} '
                 f'L {x0+lw*0.70:.1f} {y0+lh*1.6:.1f} Z" fill="#FFFFFF" opacity="0.16"/>'
                 f'</g>')

        if rim == "full":
            o.append(stroked(p, rim_w, body))
        elif rim == "semi":
            o.append(f'<g clip-path="url(#c{uid})">{stroked(p, rim_w, body)}</g>')
            o.append(f'<path d="{p}" fill="none" stroke="{pal["shade"]}" '
                     f'stroke-width="1.3" opacity="0.55"/>')
        else:
            o.append(f'<path d="{p}" fill="none" stroke="#93A8B6" '
                     f'stroke-width="1.0" opacity="0.8"/>')
            sx = ccx + (-1 if side == "left" else 1) * lw * 0.42
            for cxp in (sx, CX + (-1 if side == "left" else 1) * (br * 0.42)):
                o.append(f'<circle cx="{cxp:.1f}" cy="{CY-lh*0.20:.1f}" r="2.3" '
                         f'fill="{pal["base"]}" stroke="{pal["shade"]}" stroke-width="0.6"/>')

    o.append('</svg>')
    return "".join(o)
