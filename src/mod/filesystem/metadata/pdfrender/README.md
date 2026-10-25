# pdfrender

A pure Go PDF page rasteriser with no cgo and no external tools. The File
Manager uses it to draw thumbnails of PDF files on the server
(`../pdf.go`, package `metadata`). It renders on every target ArozOS ships,
32-bit ARM and MIPS included.

```go
doc, err := pdfrender.Open(readerAt, size)
img, err := doc.Render(0, pdfrender.Options{Scale: 2}) // *image.RGBA
thumb, err := pdfrender.Thumbnail(readerAt, size, 480, 15*time.Second)
```

`Render` returns the image drawn so far together with `ErrTimeout` when a page
runs out of time or of its operation budget, so a slow page still gets a
thumbnail.

## What it covers

| Area | Files | Notes |
|---|---|---|
| File structure | `document.go`, `object.go` | Classic, stream and hybrid xref, `/Prev` chains, object streams, lazy loading over `io.ReaderAt`, and a whole-file scan that rebuilds a broken table |
| Encryption | `crypt.go` | Standard handler with the empty user password: RC4 40-128, AES-128, AES-256 (R5/R6). Files that need a password return `ErrEncrypted` |
| Filters | `filters.go` | Flate, LZW, ASCII85, ASCIIHex, RunLength, PNG/TIFF predictors and CCITT. Every filter has a size limit |
| Graphics | `render.go`, `raster.go` | Paths, both fill rules, strokes (caps, joins, dashes), clipping, constant alpha, the common blend modes, soft masks, optional content, annotation appearances |
| Colour | `color.go`, `function.go` | Device, Cal, Lab, ICC (read as N components), Indexed, Separation and DeviceN through function types 0, 2, 3 and 4 |
| Images | `image.go`, `xobject.go` | Raw samples (1-16 bit), JPEG (CMYK handled the way pdf.js does), CCITT, Decode arrays, stencil and colour key masks, soft masks, inline images. Decoding box-filters large images down to the size they are drawn at |
| Shadings | `shading.go` | Function, axial and radial shadings; mesh types 4-7 as flat shaded triangles; shading and tiling patterns |
| Text | `font.go`, `truetype.go`, `cff.go`, `type1.go`, `cmap.go`, `encoding.go` | Embedded TrueType/OpenType, CFF (incl. CID keyed) and Type 1 programs, Type 3 fonts, CMaps and ToUnicode. Fonts that are not embedded use the Go fonts, stretched to the PDF's widths |

Not supported: JPEG 2000 and JBIG2 images are drawn as a light grey
placeholder, ICC profiles are not applied, knockout and isolated groups are
treated as normal, and non-embedded CJK fonts are not drawn (no CJK font ships
with the system).

## Rules for changes

The package parses untrusted files: every PDF in a folder gets opened for its
thumbnail. Keep to these rules:

- No recursion that the file controls without a depth limit (forms, Type 3
  glyphs, patterns and soft masks are also guarded against using themselves).
- Write length checks so they cannot overflow (`n > len(b)-p`), and bound
  allocations by the data that is actually present.
- Run `hardening_test.go` and the 32-bit test run before merging:
  `GOARCH=386 go test ./mod/filesystem/metadata/pdfrender/`.
