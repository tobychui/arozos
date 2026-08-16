package metadata

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png"
	"io"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"

	"github.com/nfnt/resize"
	"imuslab.com/arozos/mod/filesystem"
)

/*
	G-code thumbnail extraction

	Slicers (PrusaSlicer, SuperSlicer, OrcaSlicer, BambuStudio, AnycubicSlicer,
	Cura with the thumbnail plugin, ...) embed one or more preview images in the
	comment header of a sliced G-code file, base64 encoded between marker lines:

		; thumbnail begin 230x110 2088
		; iVBORw0KGgoAAAANSUhEUgAAAOYAAABuCAYAAA...
		; ...
		; thumbnail end

	The marker may carry a format suffix (`thumbnail_JPG begin`) and a trailing
	tag naming an alternate camera angle (`... 512x512 2484 top`). Files can
	hold several thumbnails at different sizes; the untagged ones are the
	regular preview a user sees in their slicer, so those are preferred, and
	the largest is picked from whichever group is used.
*/

var (
	gcodeThumbnailBegin = regexp.MustCompile(`(?i)^;\s*thumbnail(?:_[a-z0-9]+)?\s+begin\s+(\d+)\s*[xX]\s*(\d+)\s+(\d+)\s*(\S*)`)
	gcodeThumbnailEnd   = regexp.MustCompile(`(?i)^;\s*thumbnail(?:_[a-z0-9]+)?\s+end`)
)

// Thumbnails live in the comment header, so there is no reason to walk through
// the whole toolpath of what can be a several hundred megabyte file.
const gcodeThumbnailScanLimit = 4 << 20

// gcodeThumbnail is one embedded preview as found in the file, still encoded.
type gcodeThumbnail struct {
	width  int
	height int
	tag    string // alternate camera angle, e.g. "top"; empty for the main preview
	data   []byte
}

// ExtractGcodeThumbnails returns every embedded preview found in the header of
// a G-code stream, in the order they appear. Reading stops after
// gcodeThumbnailScanLimit bytes.
func extractGcodeThumbnails(r io.Reader) ([]gcodeThumbnail, error) {
	scanner := bufio.NewScanner(io.LimitReader(r, gcodeThumbnailScanLimit))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	found := []gcodeThumbnail{}
	var current *gcodeThumbnail
	var payload bytes.Buffer

	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 || line[0] != ';' {
			continue
		}

		if current == nil {
			match := gcodeThumbnailBegin.FindSubmatch(line)
			if match == nil {
				continue
			}
			width, _ := strconv.Atoi(string(match[1]))
			height, _ := strconv.Atoi(string(match[2]))
			current = &gcodeThumbnail{width: width, height: height, tag: string(match[4])}
			payload.Reset()
			continue
		}

		if gcodeThumbnailEnd.Match(line) {
			data, err := base64.StdEncoding.DecodeString(payload.String())
			if err == nil && len(data) > 0 {
				current.data = data
				found = append(found, *current)
			}
			current = nil
			continue
		}

		// a payload line: everything after the comment marker, whitespace free
		payload.Write(bytes.TrimSpace(bytes.TrimLeft(line, "; ")))
	}

	if err := scanner.Err(); err != nil {
		return found, err
	}
	return found, nil
}

// pickGcodeThumbnails orders the candidates best first: the untagged previews
// before the alternate angles, and larger before smaller within each group.
func pickGcodeThumbnails(thumbnails []gcodeThumbnail) []gcodeThumbnail {
	ordered := make([]gcodeThumbnail, len(thumbnails))
	copy(ordered, thumbnails)
	sort.SliceStable(ordered, func(i, j int) bool {
		if (ordered[i].tag == "") != (ordered[j].tag == "") {
			return ordered[i].tag == ""
		}
		return ordered[i].width*ordered[i].height > ordered[j].width*ordered[j].height
	})
	return ordered
}

// DecodeGcodeThumbnail returns the best embedded preview of a G-code stream as
// a decoded image. Candidates are tried best first, so a preview in a format
// this build cannot decode (some slicers can emit QOI) falls through to the
// next one instead of failing the whole file.
func decodeGcodeThumbnail(r io.Reader) (image.Image, error) {
	thumbnails, err := extractGcodeThumbnails(r)
	if err != nil && len(thumbnails) == 0 {
		return nil, err
	}
	if len(thumbnails) == 0 {
		return nil, errors.New("no embedded thumbnail in this gcode file")
	}

	for _, thumbnail := range pickGcodeThumbnails(thumbnails) {
		img, _, decodeErr := image.Decode(bytes.NewReader(thumbnail.data))
		if decodeErr == nil {
			return img, nil
		}
	}
	return nil, errors.New("embedded thumbnail is in an unsupported image format")
}

// trimTransparent crops src down to the area that actually carries opaque
// pixels. Slicer previews render the model onto a transparent plate with a
// generous margin, so without this the model ends up as a small island in the
// middle of the thumbnail. An image with no transparency is returned unchanged.
func trimTransparent(src image.Image) image.Image {
	bounds := src.Bounds()
	minX, minY := bounds.Max.X, bounds.Max.Y
	maxX, maxY := bounds.Min.X, bounds.Min.Y

	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			if _, _, _, alpha := src.At(x, y).RGBA(); alpha > 0x2000 {
				if x < minX {
					minX = x
				}
				if y < minY {
					minY = y
				}
				if x > maxX {
					maxX = x
				}
				if y > maxY {
					maxY = y
				}
			}
		}
	}

	if minX > maxX || minY > maxY {
		//fully transparent, nothing to trim against
		return src
	}

	//keep a small margin so the model does not touch the thumbnail edge
	margin := (maxX - minX + maxY - minY) / 40
	content := image.Rect(minX-margin, minY-margin, maxX+1+margin, maxY+1+margin).Intersect(bounds)

	type subImager interface {
		SubImage(r image.Rectangle) image.Image
	}
	if sub, ok := src.(subImager); ok {
		return sub.SubImage(content)
	}

	cropped := image.NewRGBA(image.Rect(0, 0, content.Dx(), content.Dy()))
	draw.Draw(cropped, cropped.Bounds(), src, content.Min, draw.Src)
	return cropped
}

// fitOnCanvas scales src to fit inside a size x size square and centers it on
// an opaque background. Slicer previews are usually transparent and are often
// far from square, so they are letterboxed rather than center cropped: cropping
// a 230x110 preview to a square would cut most of the model out of frame.
func fitOnCanvas(src image.Image, size int, background color.Color) image.Image {
	bounds := src.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()
	if width <= 0 || height <= 0 {
		return src
	}

	if width > height {
		src = resize.Resize(uint(size), 0, src, resize.Lanczos3)
	} else {
		src = resize.Resize(0, uint(size), src, resize.Lanczos3)
	}
	bounds = src.Bounds()

	canvas := image.NewRGBA(image.Rect(0, 0, size, size))
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{background}, image.Point{}, draw.Src)

	offset := image.Pt((size-bounds.Dx())/2, (size-bounds.Dy())/2)
	target := image.Rectangle{Min: offset, Max: offset.Add(bounds.Size())}
	draw.Draw(canvas, target, src, bounds.Min, draw.Over)
	return canvas
}

func generateThumbnailForGcode(fsh *filesystem.FileSystemHandler, cacheFolder string, file string, generateOnly bool) (string, error) {
	if fsh.RequireBuffer {
		return "", nil
	}
	fshAbs := fsh.FileSystemAbstraction

	if !fshAbs.FileExists(file) {
		//The user removed this file before the thumbnail is finished
		return "", errors.New("Source not exists")
	}

	f, err := fshAbs.Open(file)
	if err != nil {
		return "", err
	}
	img, err := decodeGcodeThumbnail(f)
	f.Close()
	if err != nil {
		return "", err
	}

	//Slicer previews are transparent with a wide margin; crop to the model and
	//flatten onto white to match the render used for the other 3D model
	//thumbnails
	thumbnail := fitOnCanvas(trimTransparent(img), 480, color.White)

	outputFile := cacheFolder + filepath.Base(file) + ".jpg"
	outf, err := fshAbs.Create(outputFile)
	if err != nil {
		return "", err
	}
	err = jpeg.Encode(outf, thumbnail, &jpeg.Options{Quality: 90})
	outf.Close()
	if err != nil {
		return "", err
	}

	if !generateOnly && fshAbs.FileExists(outputFile) {
		//return the image as well
		ctx, err := getImageAsBase64(fsh, outputFile)
		return ctx, err
	} else if !fshAbs.FileExists(outputFile) {
		return "", errors.New("Image generation failed")
	}
	return "", nil
}
