package agi

import (
	"bytes"
	"encoding/binary"
	"image"
	"io"
	"strings"
	"testing"

	"github.com/gen2brain/h265/heic"
	"github.com/rwcarlsen/goexif/exif"
)

// tiffWithMake returns a little endian TIFF payload whose IFD0 holds only the
// Make tag
func tiffWithMake(make string) []byte {
	val := append([]byte(make), 0)
	var b bytes.Buffer
	b.WriteString("II*\x00")
	binary.Write(&b, binary.LittleEndian, uint32(8)) //IFD0 offset
	binary.Write(&b, binary.LittleEndian, uint16(1)) //one entry
	binary.Write(&b, binary.LittleEndian, uint16(0x010F))
	binary.Write(&b, binary.LittleEndian, uint16(2)) //ASCII
	binary.Write(&b, binary.LittleEndian, uint32(len(val)))
	binary.Write(&b, binary.LittleEndian, uint32(8+2+12+4)) //value after the IFD
	binary.Write(&b, binary.LittleEndian, uint32(0))        //no next IFD
	b.Write(val)
	return b.Bytes()
}

func TestExifSource(t *testing.T) {
	var withExif, withoutExif bytes.Buffer
	img := image.NewNRGBA(image.Rect(0, 0, 32, 32))
	if err := heic.Encode(&withExif, img, heic.EncodeOptions{Exif: tiffWithMake("TestCam")}); err != nil {
		t.Fatalf("encode: %v", err)
	}
	if err := heic.Encode(&withoutExif, img); err != nil {
		t.Fatalf("encode: %v", err)
	}

	tests := []struct {
		name     string
		path     string
		data     []byte
		wantErr  bool
		wantMake string
	}{
		{"heic with exif", "user:/IMG_0001.HEIC", withExif.Bytes(), false, `"TestCam"`},
		{"heic without exif", "user:/IMG_0002.heic", withoutExif.Bytes(), true, ""},
		{"not heic is passed through", "user:/a.jpg", []byte("jpeg bytes"), false, ""},
	}
	for _, tc := range tests {
		r, err := exifSource(bytes.NewReader(tc.data), tc.path)
		if (err != nil) != tc.wantErr {
			t.Fatalf("%s: err = %v, wantErr %v", tc.name, err, tc.wantErr)
		}
		if err != nil {
			continue
		}
		if tc.wantMake == "" {
			got, _ := io.ReadAll(r)
			if !bytes.Equal(got, tc.data) {
				t.Errorf("%s: reader was changed", tc.name)
			}
			continue
		}
		x, err := exif.Decode(r)
		if err != nil {
			t.Fatalf("%s: exif.Decode: %v", tc.name, err)
		}
		if !strings.Contains(x.String(), tc.wantMake) {
			t.Errorf("%s: exif = %s, want Make %s", tc.name, x.String(), tc.wantMake)
		}
	}
}
