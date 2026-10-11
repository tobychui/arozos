package pptx

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"errors"
	"io"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/office/internal/media"
	"imuslab.com/arozos/mod/office/internal/officetest"
	"imuslab.com/arozos/mod/office/model"
)

// sidecarPart extracts one file from the sidecar zip bytes
func sidecarPart(t *testing.T, zipData []byte, name string) []byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		t.Fatalf("sidecar zip unreadable: %v", err)
	}
	for _, f := range zr.File {
		if f.Name == name {
			rc, err := f.Open()
			if err != nil {
				t.Fatalf("open %s: %v", name, err)
			}
			defer rc.Close()
			data, _ := io.ReadAll(rc)
			return data
		}
	}
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	t.Fatalf("sidecar zip has no %s (has: %v)", name, names)
	return nil
}

func TestPptxVideoSidecarZip(t *testing.T) {
	fakeMp4 := []byte("\x00\x00\x00\x18ftypmp42fake-video-bytes")
	pres := &model.Presentation{Theme: "clean", Slides: []*model.Slide{{
		Objects: []*model.Object{
			{Type: "video", X: 100, Y: 60, W: 480, H: 270,
				Props: model.Props{Src: "../../media?file=user%3A%2F.appdata%2FOffice%2Fuploads%2Fclip.mp4"}},
		},
	}}}
	resolved := ""
	data, sidecar, err := BuildMedia(pres, func(vp string) ([]byte, error) {
		resolved = vp
		if strings.HasSuffix(vp, "clip.mp4") {
			return fakeMp4, nil
		}
		return nil, errors.New("not found")
	})
	if err != nil {
		t.Fatalf("BuildPptxMedia: %v", err)
	}
	if !strings.HasSuffix(resolved, "clip.mp4") {
		t.Fatalf("resolver saw %q", resolved)
	}
	// the media file ships in the sidecar zip under its original name
	if got := sidecarPart(t, sidecar, "clip.mp4"); string(got) != string(fakeMp4) {
		t.Fatalf("sidecar clip.mp4 bytes differ (len %d)", len(got))
	}
	// the slide shows a plain poster picture - no embedded media markup
	slide := string(officetest.ZipPart(t, data, "ppt/slides/slide1.xml"))
	if !strings.Contains(slide, "<p:pic>") {
		t.Error("slide1.xml missing poster picture")
	}
	for _, banned := range []string{"videoFile", "p14:media", "p:timing"} {
		if strings.Contains(slide, banned) {
			t.Errorf("slide1.xml still contains embedded-media markup %s", banned)
		}
	}
	// poster image part exists and is wired through the rels
	if officetest.ZipPart(t, data, "ppt/media/image1.png") == nil {
		t.Error("poster image part missing")
	}
	rels := string(officetest.ZipPart(t, data, "ppt/slides/_rels/slide1.xml.rels"))
	if !strings.Contains(rels, "media/image1.png") {
		t.Errorf("slide rels missing poster image: %s", rels)
	}
	// no media parts inside the pptx itself
	if strings.Contains(string(officetest.ZipPart(t, data, "[Content_Types].xml")), "video/mp4") {
		t.Error("pptx content types still declare embedded video")
	}
}

func TestPptxAudioDataURLSidecar(t *testing.T) {
	fakeMp3 := []byte("ID3fake-audio")
	src := "data:audio/mpeg;base64," + base64.StdEncoding.EncodeToString(fakeMp3)
	pres := &model.Presentation{Theme: "clean", Slides: []*model.Slide{{
		Objects: []*model.Object{
			{Type: "audio", X: 100, Y: 60, W: 300, H: 60, Props: model.Props{Src: src}},
		},
	}}}
	data, sidecar, err := BuildMedia(pres, nil)
	if err != nil {
		t.Fatalf("BuildPptxMedia: %v", err)
	}
	// data-URL sources get a generated name in the sidecar
	if got := sidecarPart(t, sidecar, "media1.mp3"); string(got) != string(fakeMp3) {
		t.Fatalf("sidecar media1.mp3 bytes differ (len %d)", len(got))
	}
	slide := string(officetest.ZipPart(t, data, "ppt/slides/slide1.xml"))
	if strings.Contains(slide, "audioFile") {
		t.Error("audio should not be embedded")
	}
	if !strings.Contains(slide, "<p:pic>") {
		t.Error("audio poster picture missing")
	}
}

func TestPptxUsesCapturedPosterFrame(t *testing.T) {
	fakeMp4 := []byte("\x00\x00\x00\x18ftypmp42fake")
	posterPng := officetest.MakePngDataURL(t, 48, 27)
	posterBytes, _, _ := media.DecodeDataURL(posterPng)
	pres := &model.Presentation{Theme: "clean", Slides: []*model.Slide{{
		Objects: []*model.Object{
			{Type: "video", X: 0, Y: 0, W: 480, H: 270,
				Props: model.Props{
					Src: "../../media?file=user%3A%2Fclip.mp4",
					Png: posterPng, // client-captured video frame
				}},
		},
	}}}
	data, sidecar, err := BuildMedia(pres, func(vp string) ([]byte, error) {
		return fakeMp4, nil
	})
	if err != nil {
		t.Fatalf("BuildPptxMedia: %v", err)
	}
	// the poster part carries the captured frame, not the generic poster
	if part := officetest.ZipPart(t, data, "ppt/media/image1.png"); string(part) != string(posterBytes) {
		t.Errorf("poster part is not the captured frame (len %d vs %d)",
			len(part), len(posterBytes))
	}
	if sidecarPart(t, sidecar, "clip.mp4") == nil {
		t.Error("sidecar missing the media file")
	}
}

func TestPptxUnresolvableMediaStillShowsPoster(t *testing.T) {
	pres := &model.Presentation{Theme: "clean", Slides: []*model.Slide{{
		Objects: []*model.Object{
			{Type: "text", X: 0, Y: 0, W: 400, H: 80, Props: model.Props{HTML: "hello"}},
			{Type: "video", X: 0, Y: 100, W: 480, H: 270,
				Props: model.Props{Src: "../../media?file=user%3A%2Fmissing.mp4"}},
		},
	}}}
	// legacy no-resolver path: the poster still renders, no sidecar
	data, err := Build(pres)
	if err != nil {
		t.Fatalf("BuildPptx: %v", err)
	}
	slide := string(officetest.ZipPart(t, data, "ppt/slides/slide1.xml"))
	if !strings.Contains(slide, "hello") {
		t.Error("text lost")
	}
	if !strings.Contains(slide, "<p:pic>") {
		t.Error("poster picture missing for unresolvable video")
	}
	if strings.Contains(slide, "videoFile") {
		t.Error("unresolvable video must not be embedded")
	}
	_, sidecar, err := BuildMedia(pres, nil)
	if err != nil {
		t.Fatalf("BuildPptxMedia: %v", err)
	}
	if sidecar != nil {
		t.Errorf("expected no sidecar zip, got %d bytes", len(sidecar))
	}
}
