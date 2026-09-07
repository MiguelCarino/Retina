"""Generate the Carino Retina mark — the app and packaging icons — with the
standard library only (no Pillow), so a build machine needs nothing installed.

A hand port of Carino-PACS/desktop/assets/make_icon.py by way of the
DICOM-editor one, and the ring is still the shared fleet brand: R, W, GAP and
GOLD are not this app's to vary. The lockup around it is, and all three siblings
differ only in which character they stand beside the ring — the PACS a D, the
editor an E, this one an R. Nothing enforces that:
the files are hand ports, not vendored copies, so re-porting any one of them
over another would silently delete the app-specific glyph. Sync ring constants
only. The tray step is absent here as it is in the editor, and unlike in the
PACS, because Retina is a document app and has no tray.

Why an R and not the pupil this file used to draw. The pupil was the better
drawing and it is worth recording what retiring it costs, because the trade was
made deliberately and not by accident.

It said eye: a bold annulus is an iris the moment something sits at its centre,
and a dot has no thin part to lose, needs no clear space of its own because the
ring's counter already is that clear space, and cannot collide with the ring at
any GAP because it is strictly inside the inner radius. PUP = 9 put stroke,
clear gap and pupil diameter within a design unit of each other — 2.62, 2.78 and
2.95 device px at 16x16, all well clear of the ~1.2 px floor.

The R's stems are one module, which fits to 1.24 device px at 16x16 — the same
number measured for the editor's E bands, and right on that floor. So this mark
is legible where the pupil was comfortable, and that is the price.

What buys it is that the fleet now has thirty-eight sites and one system: a gold
C with one character beside it, the character being the site's own initial
wherever that initial is unclaimed. A mark that says "eye" but not "which
Carino" was the odd one out, and an interior glyph and an exterior one cannot be
told apart as members of one set. Nothing about the pupil's geometry was wrong;
it just stopped being the question.

Both shapes are drawn from the constants below rather than traced from a bitmap,
so any size can be regenerated exactly. That is the point here: this repo's only
image is a 50x50 logo.webp, which no amount of upscaling turns into a crisp
1024px ic10 member.

The lockup now leaves the 100x100 drawing space to the right before fitting, as
the editor's does, so _fit() takes the union of the ring's box and the glyph's.
It returns the affine rather than one shape's fitted constants: there are two
shapes to place, and deriving the transform twice would let them drift. Bare
constants below are pre-fit, M-prefixed ones post-fit.

../../logo.webp, the web favicon, is this mark now — the black hand-drawn eye
that predated the fleet ring is gone. It is still not written from here: the
webp needs ImageMagick, and the desktop build must not touch the web payload.
Branding/marks/ holds the fleet copy and this file's logo.svg matches it
byte for byte. See the note printed at the end.

Run:  python3 make_icon.py
"""
import math
import os
import struct
import zlib

GOLD = (0xEA, 0xB3, 0x08)

# --- the mark ------------------------------------------------------------
# Drawn in a 100x100 space, then fitted to the canvas with equal padding.
CX = CY = 50.0      # centre of the ring
R = 34.0            # arc centreline radius
W = 16.0            # stroke width  -> outer 42, inner 26
GAP = 44.0          # half the mouth, in degrees, opening to the right
PAD = 7.0           # clear space around the mark, in the same 100 units

# The character, on the box the editor's mini E stands in: spine on the ring's
# circumscribing circle, cap height equal to the C's own counter diameter, so it
# reads as belonging to the C rather than merely standing next to it.
#
# Six columns by ten rows, not the E's three by five. Three columns cannot keep
# an alphabet apart — on that grid A, K and M each sit ONE cell from H — and R
# is one of the letters that needs the finer grid to get a leg at all. Stems
# stay two modules wide, so the E and T already shipping are unchanged by it.
GS = (2 * R - W) / 10       # 5.2    half module; a stem is two of them
GX0 = CX + R + W / 2        # 92.0   spine stands on the ring's outer radius
GX1 = GX0 + 6 * GS          # 123.2  the composition's rightmost ink
GT, GB = CY - 5 * GS, CY + 5 * GS
COLS, ROWS = 6, 10

GLYPH = ("######", "######", "##..##", "##..##", "######",
         "######", "##.##.", "##.##.", "##..##", "##..##")


def _fit():
    """Optical centring. Returns the affine (scale, tx, ty) rather than any one
    shape's fitted constants: there are two shapes to place, and deriving the
    transform twice would let them drift apart.

    The C's rightmost ink is the outer corner of a terminal, not the full width
    of the ring, so the raw drawing sits left of centre. Fit its real bounding
    box instead of the circle's — now the union of the ring's and the glyph's,
    and the glyph always wins on the right. Top and bottom need no union term:
    the glyph is centred on CY and its cap height 2R - W is less than the ring's
    2R + W for any positive W, so the ring stays the vertical extreme.
    """
    ro = R + W / 2
    left, top, bottom = CX - ro, CY - ro, CY + ro
    right = max(CX + ro * math.cos(math.radians(GAP)), GX1)
    w, h = right - left, bottom - top
    s = (100 - 2 * PAD) / max(w, h)
    tx = PAD + (100 - 2 * PAD - w * s) / 2 - left * s
    ty = PAD + (100 - 2 * PAD - h * s) / 2 - top * s
    return s, tx, ty


# One transform, both shapes hung off it. With the character the composition is
# width-bound (w = 115.2 against h = 84), so ink lands on x 7.000..93.000,
# exactly PAD either side, and the spare tile is above and below.
S, TX, TY = _fit()
MX, MY, MR, MW = CX * S + TX, CY * S + TY, R * S, W * S
MGL, MGR = GX0 * S + TX, GX1 * S + TX
MGT, MGB = GT * S + TY, GB * S + TY


def _glyph_cov(u, v, px):
    """How much of the pixel the character covers, by exact area overlap.

    Not a signed distance like the ring. Modules share edges, and unioning
    their distances with min() leaves sd = 0 along every shared edge, which
    renders as a seam drawn straight through the letter — the pupil could be a
    plain min() because it was one disc; a bitmap cannot. Area overlap has no
    such artefact and is exact for axis-aligned cells.
    """
    h = px / 2
    x0, x1, y0, y1 = u - h, u + h, v - h, v + h
    if x1 <= MGL or x0 >= MGR or y1 <= MGT or y0 >= MGB:
        return 0.0
    cw, ch = (MGR - MGL) / COLS, (MGB - MGT) / ROWS
    c0 = max(0, int((x0 - MGL) // cw)); c1 = min(COLS - 1, int((x1 - MGL) // cw))
    r0 = max(0, int((y0 - MGT) // ch)); r1 = min(ROWS - 1, int((y1 - MGT) // ch))
    area = 0.0
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            if GLYPH[r][c] != "#":
                continue
            ox = min(x1, MGL + (c + 1) * cw) - max(x0, MGL + c * cw)
            oy = min(y1, MGT + (r + 1) * ch) - max(y0, MGT + r * ch)
            if ox > 0 and oy > 0:
                area += ox * oy
    return min(1.0, area / (px * px))


def _coverage(u, v, px):
    """How much of the pixel at (u, v) the mark covers, 0..1.

    The ring is analytic rather than supersampled: it is the intersection of an
    annulus and everything outside the mouth wedge, the signed distance to each
    is cheap, the larger of the two is the distance to the shape, and a
    one-pixel ramp across it is the anti-aliasing. The character is unioned in
    by area, and the two can never overlap — the glyph box starts on the ring's
    circumscribing circle, so no point in it is ring ink at any GAP.
    """
    dx, dy = u - MX, v - MY
    d = math.hypot(dx, dy)
    ring = abs(d - MR) - MW / 2                        # <0 inside the stroke
    if d < 1e-9:
        # The mouth's angle is undefined at the exact centre. The ring term
        # alone is correct there — the centre is MR - MW/2 clear of the stroke.
        sd_c = ring
    else:
        ang = abs(math.degrees(math.atan2(-dy, dx)))   # 0 at the mouth's centre
        wedge = d * math.sin(math.radians(GAP - ang))  # <0 outside the mouth
        sd_c = max(ring, wedge)

    ring_cov = min(1.0, max(0.0, 0.5 - sd_c / px))
    return max(ring_cov, _glyph_cov(u, v, px))


def png_bytes(size):
    px = 100.0 / size                                  # one pixel, in mark units
    raw = bytearray()
    for y in range(size):
        raw.append(0)                                  # filter type 0
        v = (y + 0.5) * px
        for x in range(size):
            a = _coverage((x + 0.5) * px, v, px)
            raw += bytes(GOLD + (int(round(255 * a)),)) if a else b"\0\0\0\0"

    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data
                + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))


def write_png(path, size):
    with open(path, "wb") as f:
        f.write(png_bytes(size))
    print("wrote", path, f"{size}x{size}")


# --- the platform bundles ------------------------------------------------
# Both formats are containers around PNGs, which is what the icons the fleet
# already ships turned out to hold, so they are written here rather than shelled
# out to a tool that has to be installed first. ImageMagick is not an option for
# the mac one: `magick x.png out.icns` writes a bare PNG under an .icns name,
# which loads nowhere and fails silently.

ICNS_TYPES = [(b"ic11", 32), (b"ic12", 64), (b"ic07", 128), (b"ic08", 256),
              (b"ic13", 256), (b"ic09", 512), (b"ic14", 512), (b"ic10", 1024)]


def write_icns(path, cache=None):
    cache = {} if cache is None else cache
    body = b""
    for typ, size in ICNS_TYPES:
        if size not in cache:
            cache[size] = png_bytes(size)
        body += typ + struct.pack(">I", len(cache[size]) + 8) + cache[size]
    with open(path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(body) + 8) + body)
    print("wrote", path, f"{len(ICNS_TYPES)} members")


ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)


def write_ico(path, cache=None):
    cache = {} if cache is None else cache
    pngs = []
    for size in ICO_SIZES:
        if size not in cache:
            cache[size] = png_bytes(size)
        pngs.append(cache[size])
    offset = 6 + 16 * len(pngs)
    head = struct.pack("<HHH", 0, 1, len(pngs))
    for size, data in zip(ICO_SIZES, pngs):
        dim = 0 if size >= 256 else size               # 0 means 256 in an ICO
        head += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    with open(path, "wb") as f:
        f.write(head + b"".join(pngs))
    print("wrote", path, f"{len(pngs)} sizes")


def write_svg(path):
    """The vector source, from the same constants — for anything that wants the
    mark at a size this script was not run at. Both shapes pick the fitted
    numbers up automatically, so the vector cannot drift from the raster.

    Cell edges are interpolated across the box rather than stepped by a rounded
    module: six steps of a 2dp module land 0.01 short of the right edge, where
    interpolating rounds to the very numbers the shipped E and T already use.
    The result is byte-identical to Branding/marks/retina.svg.
    """
    def pt(deg):
        return (MX + MR * math.cos(math.radians(deg)),
                MY - MR * math.sin(math.radians(deg)))
    x1, y1 = pt(GAP)
    x2, y2 = pt(-GAP)
    colour = "#%02x%02x%02x" % GOLD
    d = []
    for r, row in enumerate(GLYPH):
        for c, ch in enumerate(row):
            if ch != "#":
                continue
            a = MGL + (MGR - MGL) * c / COLS
            b = MGL + (MGR - MGL) * (c + 1) / COLS
            t = MGT + (MGB - MGT) * r / ROWS
            u = MGT + (MGB - MGT) * (r + 1) / ROWS
            d.append(f"M {a:.2f} {t:.2f} H {b:.2f} V {u:.2f} H {a:.2f} Z")
    with open(path, "w", encoding="utf-8") as f:
        f.write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" '
                'width="512" height="512" role="img" aria-label="Carino Retina">'
                f'<path d="M {x1:.2f} {y1:.2f} A {MR:.2f} {MR:.2f} 0 1 0 {x2:.2f} {y2:.2f}" '
                f'fill="none" stroke="{colour}" stroke-width="{MW:.2f}" '
                'stroke-linecap="butt"/>'
                f'<path d="{" ".join(d)}" fill="{colour}"/></svg>')
    print("wrote", path)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    write_svg(os.path.join(here, "logo.svg"))
    write_png(os.path.join(here, "icon.png"), 512)   # window icon (runtime)
    write_png(os.path.join(here, "logo50.png"), 50)  # source for the web webp
    # Size set for Linux packaging (electron-builder linux.icon = this dir).
    build = os.path.join(here, "..", "build")
    icons = os.path.join(build, "icons")
    os.makedirs(icons, exist_ok=True)
    shared = {}
    for sz in (16, 24, 32, 48, 64, 128, 256, 512):
        shared[sz] = png_bytes(sz)
        with open(os.path.join(icons, "%dx%d.png" % (sz, sz)), "wb") as f:
            f.write(shared[sz])
        print("wrote", os.path.join(icons, "%dx%d.png" % (sz, sz)), f"{sz}x{sz}")
    write_icns(os.path.join(build, "icon.icns"), shared)
    write_ico(os.path.join(build, "icon.ico"), shared)
    print()
    print("The one step this script cannot do, because it needs ImageMagick:")
    print("  the web favicon. Run it from this script's own directory,")
    print("  desktop/assets/, where ../../logo.webp is the site's favicon and")
    print("  logo50.png written above is the source for a replacement --")
    print("      magick logo50.png -define webp:lossless=true ../../logo.webp")
    print("  That is a change to the web payload, not to the desktop build, so")
    print("  it stays a decision rather than a step. It has been taken: the")
    print("  black hand-drawn eye is gone and ../../logo.webp is this mark,")
    print("  kept in step with Branding/marks/retina.webp.")
