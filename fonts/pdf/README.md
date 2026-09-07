# PDF fonts

The exported report, spectacle Rx and lens order are drawn by pdf-lib. Its built-in
Helvetica is WinAnsi-encoded, so it can render English, Spanish and Portuguese and
silently drops everything else — Russian and Japanese labels came out blank. These
static, subsetted TTFs are what `newPdf()` embeds instead, chosen by interface language:

| file                 | covers                                   | used for      |
|----------------------|------------------------------------------|---------------|
| `PlexSans-400/700`   | Latin-1, Latin Ext-A, Greek, Cyrillic     | en, es, pt-BR, ru |
| `NotoSansJP-400/700` | the above + kana, CJK punctuation, kanji  | ja            |

The Japanese faces carry JIS X 0208 level 1 plus every character the four dictionaries
in `i18n.js` contain — level 1 alone is not enough, since 中心窩, 処方箋, 瘢痕 and 動脈瘤
are all level 2 and a lesion type reaches the PDF verbatim.

Rebuild with `tools/build-pdf-fonts.py`, which reads `i18n.js` so the subsets and the
dictionaries cannot drift apart. Sources are the upstream variable fonts:

- IBM Plex Sans — https://github.com/IBM/plex (OFL-1.1, `OFL-IBMPlexSans.txt`)
- Noto Sans JP — https://github.com/google/fonts/tree/main/ofl/notosansjp (OFL-1.1, `OFL-NotoSansJP.txt`)

`vendor/fontkit.umd.min.js` is fetched on the first export, not at page load; these
files are fetched with it, and only the pair the current language needs.
