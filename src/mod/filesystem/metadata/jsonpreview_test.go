package metadata

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"
)

// encodeJPEG builds a small solid colour JPEG and returns it base64 encoded.
func encodeJPEG(t *testing.T, width, height int, c color.Color) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatalf("could not encode test jpeg: %v", err)
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

func TestExtractJSONPreview(t *testing.T) {
	jpg := encodeJPEG(t, 6, 4, color.RGBA{200, 10, 10, 255})
	pngData := encodePNG(t, 3, 5, color.RGBA{0, 0, 255, 255})

	tests := []struct {
		name    string
		source  string
		wantErr bool
		wantW   int
		wantH   int
	}{
		{
			name:   "data url as the first field",
			source: `{"_ao_preview":"data:image/jpeg;base64,` + jpg + `","format":"aopart","features":[]}`,
			wantW:  6, wantH: 4,
		},
		{
			name:   "bare base64 after nested values",
			source: `{"format":"aoasm","parts":[{"a":[1,2,{"b":"}"}]},null],"meta":{"x":{"y":[]}},"_ao_preview":"` + pngData + `"}`,
			wantW:  3, wantH: 5,
		},
		{
			name:   "pretty printed with a byte order mark",
			source: "\xEF\xBB\xBF\n{\n \"format\": \"aodrw\",\n \"_ao_preview\": \"data:image/png;base64," + pngData + "\"\n}",
			wantW:  3, wantH: 5,
		},
		{
			name:    "no preview field",
			source:  `{"format":"aopart","features":[]}`,
			wantErr: true,
		},
		{
			name:    "preview only in a nested object",
			source:  `{"inner":{"_ao_preview":"` + pngData + `"}}`,
			wantErr: true,
		},
		{
			name:    "top level array",
			source:  `[{"_ao_preview":"` + pngData + `"}]`,
			wantErr: true,
		},
		{
			name:    "preview is not a string",
			source:  `{"_ao_preview":{"data":"` + pngData + `"}}`,
			wantErr: true,
		},
		{
			name:    "data url of something that is not an image",
			source:  `{"_ao_preview":"data:text/plain;base64,aGVsbG8="}`,
			wantErr: true,
		},
		{
			name:    "not base64",
			source:  `{"_ao_preview":"%%% not base64 %%%"}`,
			wantErr: true,
		},
		{
			name:    "truncated json",
			source:  `{"format":"aopart","features":[1,2`,
			wantErr: true,
		},
		{
			name:    "not json at all",
			source:  "G28\nG1 X10\n",
			wantErr: true,
		},
		{
			name:    "empty file",
			source:  "",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := extractJSONPreview(strings.NewReader(tt.source))
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got %d bytes of preview", len(data))
				}
				return
			}
			if err != nil {
				t.Fatalf("extractJSONPreview returned error: %v", err)
			}
			img, err := decodePreviewImage(data)
			if err != nil {
				t.Fatalf("decodePreviewImage returned error: %v", err)
			}
			if img.Bounds().Dx() != tt.wantW || img.Bounds().Dy() != tt.wantH {
				t.Errorf("preview is %dx%d, want %dx%d", img.Bounds().Dx(), img.Bounds().Dy(), tt.wantW, tt.wantH)
			}
		})
	}
}

func TestDecodePreviewPayload(t *testing.T) {
	tests := []struct {
		name    string
		payload string
		want    string
		wantErr bool
	}{
		{name: "bare padded base64", payload: "aGVsbG8=", want: "hello"},
		{name: "bare unpadded base64", payload: "aGVsbG8", want: "hello"},
		{name: "line breaks inside", payload: "aGVs\r\nbG8=", want: "hello"},
		{name: "image data url", payload: "data:image/webp;base64,aGVsbG8=", want: "hello"},
		{name: "upper case media type", payload: "data:IMAGE/PNG;BASE64,aGVsbG8=", want: "hello"},
		{name: "data url without base64", payload: "data:image/png,hello", wantErr: true},
		{name: "data url without comma", payload: "data:image/png;base64", wantErr: true},
		{name: "empty", payload: "", wantErr: true},
		{name: "too long", payload: strings.Repeat("A", jsonPreviewMaxChars+4), wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := decodePreviewPayload(tt.payload)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("decodePreviewPayload returned error: %v", err)
			}
			if string(got) != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestDecodePreviewImageRejectsHugePictures(t *testing.T) {
	//A PNG header claiming a huge size must be refused before decoding
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewGray(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatalf("could not encode test png: %v", err)
	}
	data := buf.Bytes()
	//IHDR width and height live at bytes 16..24; the CRC is not checked by DecodeConfig
	huge := append([]byte{}, data...)
	copy(huge[16:20], []byte{0x00, 0x01, 0x00, 0x00}) // 65536 wide
	if _, err := decodePreviewImage(huge); err == nil {
		t.Fatal("a 65536 pixel wide preview was accepted")
	}

	if _, err := decodePreviewImage([]byte("not an image")); err == nil {
		t.Fatal("bytes that are no picture were accepted")
	}
}

func TestThumbnailSupportedJSONPreviewFormats(t *testing.T) {
	tests := []struct {
		name string
		want bool
	}{
		{"Bracket.aopart", true},
		{"Assembly1.AOASM", true},
		{"Drawing1.aodrw", true},
		{"config.json", true},
		{"notes.txt", false},
	}
	for _, tt := range tests {
		if got := ThumbnailSupported(tt.name); got != tt.want {
			t.Errorf("ThumbnailSupported(%q) = %v, want %v", tt.name, got, tt.want)
		}
	}
}
