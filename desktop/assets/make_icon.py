"""Generate the Carino Retina mark — the app and packaging icons — with the
standard library only (no Pillow), so a build machine needs nothing installed.

A hand port of Carino-PACS/desktop/assets/make_icon.py by way of the
DICOM-editor one, and the ring is still the shared fleet brand: R, W, GAP and
GOLD are not this app's to vary. The lockup around it is, and all three siblings
differ — the PACS draws the C alone, the editor stands a mini E beside it (a
CE), and this one sets a filled pupil at the C's centre. Nothing enforces that:
the files are hand ports, not vendored copies, so re-porting any one of them
over another would silently delete the app-specific glyph. Sync ring constants
only. The tray step is absent here as it is in the editor, and unlike in the
PACS, because Retina is a document app and has no tray.

Why a pupil. Retina marks up fundus photographs and writes refractions, so the
mark has to say eye, and the fleet ring is already most of one: a bold annulus
is an iris the moment something sits at its centre. A dot is also the only
addition that survives the real constraint, which is 16x16 and not 512 — it has
no thin part to lose, it needs no clear space of its own because the ring's
counter already is that clear space, and it cannot collide with the ring at any
GAP because it is strictly inside the inner radius. Drawing an eye outline, a
lens, or a cross-section instead means strokes thinner than the ring's, and
whatever is thinnest is what fails first.

PUP = 9 is where the three concentric features across a radius come out nearly
one module: stroke 16, clear gap 17, pupil diameter 18 design units, which
fitted are 2.62, 2.78 and 2.95 device px at 16x16 — all well over the ~1.2 px
floor measured for the editor's E, and none of them the obvious first casualty.
The exact equal-thirds point is (R - W/2) / 3 = 8.67; 9.0 is that rounded up to
a whole design unit, the extra tenth going to the pupil rather than the gap
because the pupil is the feature carrying the meaning, while the gap only has to
not close.

Both shapes are drawn from the constants below rather than traced from a bitmap,
so any size can be regenerated exactly. That is the point here: this repo's only
image is a 50x50 logo.webp, which no amount of upscaling turns into a crisp
1024px ic10 member.

Unlike the editor's lockup, this one stays inside the 100x100 drawing space, so
_fit()'s bounding box is the PACS's again — the pupil is strictly interior and
cannot widen it. It still returns the affine rather than one shape's fitted
constants: there are two shapes to place, and deriving the transform twice would
let them drift. Bare constants below are pre-fit, M-prefixed ones post-fit.

Note that ../../logo.webp, the web favicon, is not this mark: the site ships a
black hand-drawn eye that predates the fleet ring. Making the two agree needs
ImageMagick and is a change to the web payload, so it is out of scope for the
desktop build, which must not touch index.html or its assets — a decision, not
a step. See the note printed at the end.

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

# The pupil, concentric with the ring so the two cannot drift apart. See the
# docstring for why 9: it puts the stroke, the clear gap and the pupil's
# diameter within a design unit of each other, which is what keeps every part of
# the mark above the pixel floor at once instead of trading one against another.
PUP = 9.0           # pupil radius -> 17 units of clear counter around it


def _fit():
    """Optical centring. Returns the affine (scale, tx, ty) rather than any one
    shape's fitted constants: there are two shapes to place, and deriving the
    transform twice would let them drift apart.

    The C's rightmost ink is the outer corner of a terminal, not the full width
    of the ring, so the raw drawing sits left of centre. Fit its real bounding
    box instead of the circle's. The pupil contributes no term — it is inside
    the inner radius on every side, so it cannot be an extreme of anything.
    """
    ro = R + W / 2
    left, top, bottom = CX - ro, CY - ro, CY + ro
    right = CX + ro * math.cos(math.radians(GAP))
    w, h = right - left, bottom - top
    s = (100 - 2 * PAD) / max(w, h)
    tx = PAD + (100 - 2 * PAD - w * s) / 2 - left * s
    ty = PAD + (100 - 2 * PAD - h * s) / 2 - top * s
    return s, tx, ty


# One transform, both shapes hung off it. The composition is height-bound (h =
# 84 against w = 72.2), so ink lands on y 7.000..93.000, exactly PAD top and
# bottom, and the spare tile is at the sides: x runs 13.034..86.966.
S, TX, TY = _fit()
MX, MY, MR, MW = CX * S + TX, CY * S + TY, R * S, W * S
MPUP = PUP * S


def _coverage(u, v, px):
    """How much of the pixel at (u, v) the mark covers, 0..1.

    Analytic rather than supersampled: the C is the intersection of an annulus
    and everything outside the mouth wedge, and the signed distance to each is
    cheap. Taking the larger of the two gives the distance to the shape. The
    pupil is a plain disc, so its signed distance needs no intersection at all,
    and the mark is the union of the pair — the nearer surface wins. A one-pixel
    ramp across the result is the anti-aliasing.
    """
    dx, dy = u - MX, v - MY
    d = math.hypot(dx, dy)
    ring = abs(d - MR) - MW / 2                        # <0 inside the stroke
    if d < 1e-9:
        # The mouth's angle is undefined at the exact centre. The ring term
        # alone is correct there — the centre is MR - MW/2 clear of the stroke —
        # and unlike the bare 0.0 the PACS version short-circuits with, it is a
        # distance, so it can go into the union below, where the pupil wins.
        sd_c = ring
    else:
        ang = abs(math.degrees(math.atan2(-dy, dx)))   # 0 at the mouth's centre
        wedge = d * math.sin(math.radians(GAP - ang))  # <0 outside the mouth
        sd_c = max(ring, wedge)

    sd_pup = d - MPUP                                  # <0 inside the pupil

    return min(1.0, max(0.0, 0.5 - min(sd_c, sd_pup) / px))


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
    numbers up automatically, so the vector cannot drift from the raster. The
    pupil is a bare circle rather than a hole punched in anything, which is the
    same reason it is a plain min() in _coverage(): nothing to get the winding
    rule wrong about.
    """
    def pt(deg):
        return (MX + MR * math.cos(math.radians(deg)),
                MY - MR * math.sin(math.radians(deg)))
    x1, y1 = pt(GAP)
    x2, y2 = pt(-GAP)
    colour = "#%02x%02x%02x" % GOLD
    with open(path, "w", encoding="utf-8") as f:
        f.write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" '
                'width="512" height="512" role="img" aria-label="Carino Retina">'
                f'<path d="M {x1:.2f} {y1:.2f} A {MR:.2f} {MR:.2f} 0 1 0 {x2:.2f} {y2:.2f}" '
                f'fill="none" stroke="{colour}" stroke-width="{MW:.2f}" '
                'stroke-linecap="butt"/>'
                f'<circle cx="{MX:.2f}" cy="{MY:.2f}" r="{MPUP:.2f}" '
                f'fill="{colour}"/></svg>')
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
    print("  it is a decision and not a step: the shipped logo.webp is an")
    print("  unrelated mark -- a black hand-drawn eye, not the fleet ring.")
    print("  Overwrite it only to put this one on retina.carino.systems, and")
    print("  commit that on its own.")
