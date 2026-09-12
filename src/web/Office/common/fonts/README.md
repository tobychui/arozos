# The Office suite's document fonts

These files are Noto Sans, under the SIL Open Font License ([`OFL.txt`](OFL.txt)).
They are declared in [`fonts.css`](fonts.css) and described to the apps by
[`../fonts.js`](../fonts.js) (`OfficeFonts`).

## Why they are here at all

A PDF can only show text in a font it carries, and a browser will not hand
over the bytes of a font installed on the machine. Text set in a system font
can therefore only reach a PDF as a *picture* of itself — which is what CJK
decks used to do.

Shipping the fonts breaks that. The Slides exporter
([`../../slides/slides_pdf.js`](../../slides/slides_pdf.js)) embeds these
exact bytes, subset to the glyphs the deck used, so the page you see and the
page that comes out are set in the same font, and the text stays real text:
selectable, searchable, and a few kilobytes rather than a few megabytes.

That is also why these families are on the end of every font stack the
editor writes (`OfficeFonts.stack()`): the browser picks per character, so
Latin keeps the document's own font while CJK lands on a face the exporter
can actually embed.

| file | family | covers |
|---|---|---|
| `NotoSans-{Regular,Bold,Italic,BoldItalic}.ttf` | Noto Sans | Latin, Greek, Cyrillic |
| `NotoSansTC-Regular.ttf` | Noto Sans TC | Traditional Chinese |
| `NotoSansSC-Regular.ttf` | Noto Sans SC | Simplified Chinese |
| `NotoSansJP-Regular.ttf` | Noto Sans JP | Japanese |
| `NotoSansKR-Regular.ttf` | Noto Sans KR | Korean |

The browser fetches a face only when a character actually needs it, so a
Latin-only document never pulls the CJK files.

Only the Latin family ships bold and italic. The CJK faces ship Regular and
let bold be synthesized — the browser smears the outline without moving the
advance widths, and the exporter does the same with a stroked text rendering
mode, so the two still agree. Real bold CJK would double an already large
payload for a difference neither side can see once it is on the page.

## Three constraints on any replacement

Every one of these was learned by shipping a file that broke, so if you
regenerate or add a face, hold to all three.

**1. TrueType, not CFF.** The `.otf` (CFF) builds of Noto Sans CJK are
roughly a third smaller and they embed without error — and then draw the
wrong glyphs. The embedder maps CIDs through the wrong table for CID-keyed
CFF, silently. Use the `glyf`-flavoured `.ttf`.

**2. TrueType, not WOFF2.** WOFF2 is less than half the size and the browser
reads it happily, but the exporter has to take the same file apart to build
the subset, and a WOFF2 comes back from that with no outlines at all.

**3. Glyph records must be padded to an even length.** The subsetter writes
a short `loca` table whenever the subset is small enough, which stores every
offset halved — and it does not pad, so a glyph of odd length truncates the
offsets of everything after it. The symptom is a beauty: most characters
come out blank while a handful, the ones that happen to land on an even
offset, render perfectly. Pad at build time and the problem cannot occur.

## How these files were built

From the Google Fonts variable originals, instanced to weight 400 and padded:

```bash
pip install fonttools
# one per language: notosanstc, notosanssc, notosansjp, notosanskr
curl -LO "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf"
python -m fontTools.varLib.instancer "NotoSansTC[wght].ttf" wght=400 \
    --update-name-table -o NotoSansTC-Regular.ttf
python -c "from fontTools.ttLib import TTFont; \
f = TTFont('NotoSansTC-Regular.ttf'); f['glyf'].padding = 4; \
f.save('NotoSansTC-Regular.ttf')"
```

The Latin faces come from the
[notofonts.github.io](https://github.com/notofonts/notofonts.github.io)
static builds (`fonts/NotoSans/hinted/ttf/`) and are already static; they
still go through the padding step.

To check a rebuilt face, subset it the way the exporter does and make sure
every glyph survives:

```bash
python -c "from fontTools.ttLib import TTFont; \
f = TTFont('NotoSansTC-Regular.ttf'); loca = f['loca']; \
print('unpadded glyphs:', sum(1 for i in range(len(loca)-1) \
if (loca[i+1]-loca[i]) % 4))"
```

Anything other than `0` will produce blank characters in exported PDFs.
