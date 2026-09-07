#!/usr/bin/env python3
"""Build the static, subsetted TTFs the PDF exporter embeds.

The report is drawn by pdf-lib. Its built-in Helvetica is WinAnsi-encoded, so it can
render English, Spanish and Portuguese and nothing else — Russian and Japanese labels
came out empty. Embedding needs a real TTF, and shipping a whole CJK face would be
~10 MB, so the Japanese face is cut to JIS X 0208 level 1 (the kanji set a clinical
document actually uses) plus kana, punctuation and the Latin/Cyrillic the same document
still carries in patient IDs and units.

Sources (both OFL-1.1):
  IBM Plex Sans   https://github.com/IBM/plex
  Noto Sans JP    https://github.com/google/fonts/tree/main/ofl/notosansjp

Usage: python3 tools/build-pdf-fonts.py <plex-variable.ttf> <notosansjp-variable.ttf> <outdir>
"""
import subprocess, sys, os, tempfile, json

# Latin-1 + Latin Ext-A, Cyrillic, and the punctuation/symbols the report draws:
# dashes and quotes from clean(), the degree sign, prime marks, the arrow in "Export ↗",
# minus/multiply, and the numero sign Russian uses for an ID.
BASE = ("U+0020-007E,U+00A0-00FF,U+0100-017F,U+0192,U+02C6-02DC,"
        "U+0384-03CE,U+0400-045F,U+0490-0491,"
        "U+2000-206F,U+20A0-20BF,U+2116,U+2122,U+2190-2199,"
        "U+2212,U+2215,U+2248,U+2260,U+2264-2265,U+2032-2033,U+25A0-25CF")

def jis_level1():
    """JIS X 0208 rows 16-47: the 2965 level-1 kanji, in the standard order."""
    out = []
    for row in range(16, 48):
        for cell in range(1, 95):
            try:
                ch = bytes([0xA0 + row, 0xA0 + cell]).decode("euc_jp")
            except UnicodeDecodeError:
                continue
            out.append(ch)
    return out

def dictionary_text(root):
    """Every character the four dictionaries can put on a page.

    JIS level 1 is the right *base* for Japanese free text but it is not a superset of
    the words this app uses: 中心窩 (fovea), 処方箋 (prescription), 瘢痕 (scar) and
    動脈瘤 (aneurysm) are all level 2, and a lesion type reaches the PDF verbatim. Feeding
    the dictionaries back into the subsetter keeps the fonts and i18n.js in step by
    construction, instead of by someone remembering to widen a range."""
    out = subprocess.run(
        ["node", "-e",
         "globalThis.window={addEventListener(){}};globalThis.document={addEventListener(){}};"
         "require(process.argv[1]);const I=window.I18N;"
         "process.stdout.write(JSON.stringify(I))", os.path.join(root, "i18n.js")],
        capture_output=True, text=True, check=True).stdout
    I = json.loads(out)
    chars = set()
    for loc, d in I.items():
        for k, v in d.items():
            chars.update(k); chars.update(v)
    return "".join(sorted(chars))

def run(*a):
    subprocess.run([x for x in a if x], check=True)

def instance(src, wght, out):
    # --update-name-table rewrites the name records from STAT, so the 700 instance is not
    # left calling itself Regular (and Noto's default instance is Thin, so without this
    # every embedded Japanese face reports as NotoSansJP-Thin in a PDF reader).
    run(sys.executable, "-m", "fontTools.varLib.instancer", src,
        f"wght={wght}", "--update-name-table", "--output", out)

def subset(src, out, unicodes, text_file=None):
    args = [sys.executable, "-m", "fontTools.subset", src,
            f"--unicodes={unicodes}", "--layout-features=kern,liga,ccmp,locl",
            "--name-IDs=*", "--notdef-outline", "--recalc-bounds",
            f"--output-file={out}"]
    if text_file:
        args.append(f"--text-file={text_file}")
    run(*args)

def main():
    plex_var, jp_var, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.makedirs(outdir, exist_ok=True)
    tmp = tempfile.mkdtemp()
    dict_chars = dictionary_text(root)
    # Plex is Latin/Cyrillic only; the dictionaries also carry Japanese, which pyftsubset
    # would warn about and skip. Hand it only what its ranges could hold.
    plex_txt = os.path.join(tmp, "plex.txt")
    with open(plex_txt, "w", encoding="utf-8") as fh:
        fh.write("".join(c for c in dict_chars if ord(c) < 0x2E80))
    jp_txt = os.path.join(tmp, "jp.txt")
    with open(jp_txt, "w", encoding="utf-8") as fh:
        fh.write("".join(jis_level1()) + dict_chars)
    for wght, tag in ((400, "400"), (700, "700")):
        p = os.path.join(tmp, f"plex-{tag}.ttf")
        instance(plex_var, wght, p)
        subset(p, os.path.join(outdir, f"PlexSans-{tag}.ttf"), BASE, plex_txt)

        j = os.path.join(tmp, f"jp-{tag}.ttf")
        instance(jp_var, wght, j)
        # kana, CJK punctuation and the fullwidth forms Japanese text mixes with Latin
        subset(j, os.path.join(outdir, f"NotoSansJP-{tag}.ttf"),
               BASE + ",U+3000-303F,U+3040-30FF,U+31F0-31FF,U+4E00,U+FF01-FF60,U+FFE0-FFE6",
               jp_txt)
    for f in sorted(os.listdir(outdir)):
        print(f"{f:24s} {os.path.getsize(os.path.join(outdir, f)) / 1024:8.0f} KB")

main()
