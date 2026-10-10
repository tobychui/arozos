# The Office suite's document fonts

Two kinds of font live here, all of them open: the **fallback** faces (Noto
Sans and its CJK sisters) that every font stack ends in, declared in
[`fonts.css`](fonts.css), and the **document families** - open fonts Office
files name, plus the free metric twins of the Microsoft fonts - declared by
[`../fonts.js`](../fonts.js) straight from its `SHIPPED` list. Licences:
SIL Open Font License 1.1 ([`OFL.txt`](OFL.txt)) for all but Roboto Slab,
which is Apache 2.0 ([`LICENSE-Apache-2.0.txt`](LICENSE-Apache-2.0.txt)).
Each file also carries its own copyright and licence in its name table.

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

## Document families

An Office file names the fonts it was set in. When the machine showing it
lacks one, the next best thing to the font is a copy with the same advance
widths - a **metric twin** - because then every line breaks where it did in
Office (a scaled look-alike only gets the *average* width right, and lines
near the edge of their box break somewhere else). `OfficeFonts.substitute()`
draws a missing Calibri in Carlito, Cambria in Caladea, Arial and Helvetica
in Arimo, Times New Roman in Tinos, Courier New in Cousine and Georgia in
Gelasio (`TWINS`); a machine that has the original keeps it.

The other families are open fonts in their own right that decks from Google
Slides, Canva and the like name directly (Lato, Open Sans, Playfair Display,
Roboto, ...). Shipped, they are drawn from these files rather than from a
stand-in, on every machine. Either way the PDF exporters embed the face the
screen used, so the export is real text in the right font.

A family without an italic (or bold) file is slanted (or emboldened) by the
browser from the face it has, and by the exporters the same way.

| files | family | licence | role |
|---|---|---|---|
| `Arimo-{Regular,Bold,Italic,BoldItalic}.ttf` | Arimo | OFL 1.1 | metric twin of Arial, Helvetica |
| `Caladea-{Regular,Bold,Italic,BoldItalic}.ttf` | Caladea | OFL 1.1 | metric twin of Cambria |
| `Carlito-{Regular,Bold,Italic,BoldItalic}.ttf` | Carlito | OFL 1.1 | metric twin of Calibri |
| `Cousine-{Regular,Bold,Italic,BoldItalic}.ttf` | Cousine | OFL 1.1 | metric twin of Courier New |
| `Gelasio-{Regular,Bold,Italic,BoldItalic}.ttf` | Gelasio | OFL 1.1 | metric twin of Georgia |
| `Tinos-{Regular,Bold,Italic,BoldItalic}.ttf` | Tinos | OFL 1.1 | metric twin of Times New Roman |
| `AbrilFatface-Regular.ttf` | Abril Fatface | OFL 1.1 |  |
| `AmaticSC-Regular.ttf` | Amatic SC | OFL 1.1 |  |
| `Barlow-{Regular,Bold}.ttf` | Barlow | OFL 1.1 |  |
| `BebasNeue-Regular.ttf` | Bebas Neue | OFL 1.1 |  |
| `Comfortaa-{Regular,Bold}.ttf` | Comfortaa | OFL 1.1 |  |
| `EBGaramond-{Regular,Bold,Italic,BoldItalic}.ttf` | EB Garamond | OFL 1.1 |  |
| `FiraSans-{Regular,Bold}.ttf` | Fira Sans | OFL 1.1 |  |
| `Inter-{Regular,Bold}.ttf` | Inter | OFL 1.1 |  |
| `JosefinSans-{Regular,Bold}.ttf` | Josefin Sans | OFL 1.1 |  |
| `Karla-{Regular,Bold}.ttf` | Karla | OFL 1.1 |  |
| `Lato-{Regular,Bold,Italic,BoldItalic}.ttf` | Lato | OFL 1.1 |  |
| `LibreBaskerville-{Regular,Bold}.ttf` | Libre Baskerville | OFL 1.1 |  |
| `Lora-{Regular,Bold,Italic,BoldItalic}.ttf` | Lora | OFL 1.1 |  |
| `Merriweather-{Regular,Bold,Italic,BoldItalic}.ttf` | Merriweather | OFL 1.1 |  |
| `Montserrat-{Regular,Bold,Italic,BoldItalic}.ttf` | Montserrat | OFL 1.1 |  |
| `Mulish-{Regular,Bold}.ttf` | Mulish | OFL 1.1 |  |
| `NotoSerif-{Regular,Bold,Italic,BoldItalic}.ttf` | Noto Serif | OFL 1.1 |  |
| `Nunito-{Regular,Bold}.ttf` | Nunito | OFL 1.1 |  |
| `OldStandardTT-Regular.ttf` | Old Standard TT | OFL 1.1 |  |
| `OpenSans-{Regular,Bold,Italic,BoldItalic}.ttf` | Open Sans | OFL 1.1 |  |
| `Oswald-{Regular,Bold}.ttf` | Oswald | OFL 1.1 |  |
| `PlayfairDisplay-{Regular,Bold,Italic,BoldItalic}.ttf` | Playfair Display | OFL 1.1 |  |
| `Poppins-{Regular,Bold,Italic,BoldItalic}.ttf` | Poppins | OFL 1.1 |  |
| `PTSans-{Regular,Bold}.ttf` | PT Sans | OFL 1.1 |  |
| `PTSerif-{Regular,Bold}.ttf` | PT Serif | OFL 1.1 |  |
| `Quicksand-{Regular,Bold}.ttf` | Quicksand | OFL 1.1 |  |
| `Raleway-{Regular,Bold,Italic,BoldItalic}.ttf` | Raleway | OFL 1.1 |  |
| `Roboto-{Regular,Bold,Italic,BoldItalic}.ttf` | Roboto | OFL 1.1 |  |
| `RobotoSlab-{Regular,Bold}.ttf` | Roboto Slab | Apache 2.0 |  |
| `Rubik-{Regular,Bold}.ttf` | Rubik | OFL 1.1 |  |
| `SourceSans3-{Regular,Bold,Italic,BoldItalic}.ttf` | Source Sans 3 | OFL 1.1 |  |
| `SourceSerif4-{Regular,Bold}.ttf` | Source Serif 4 | OFL 1.1 |  |
| `Spectral-Regular.ttf` | Spectral | OFL 1.1 |  |
| `WorkSans-{Regular,Bold}.ttf` | Work Sans | OFL 1.1 |  |

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

The document families come from the [google/fonts](https://github.com/google/fonts)
repository (`ofl/<family>/`, Roboto Slab from `apache/robotoslab/`; Carlito
from [googlefonts/carlito](https://github.com/googlefonts/carlito) 1.104).
Static files are used as they are; a variable font is instanced to weight 400
and 700 (width 100, every other axis at its default), the italic variable file
likewise, and each face goes through the padding step:

```bash
python -m fontTools.varLib.instancer "Lato[wght].ttf" wght=700 -o Lato-Bold.ttf
python -c "from fontTools.ttLib import TTFont; \
f = TTFont('Lato-Bold.ttf'); f['glyf'].padding = 4; f.save('Lato-Bold.ttf')"
```

A new family goes into `SHIPPED` in [`../fonts.js`](../fonts.js) with
`doc: true`, and into `METRICS` with its advances and Windows ascent and
descent, so a PowerPoint deck sets its lines the PowerPoint way. Ship only
TrueType (`glyf`) files under a licence that allows redistribution (OFL,
Apache 2.0); the Ubuntu family, for one, is under its own licence and is not
here.

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
