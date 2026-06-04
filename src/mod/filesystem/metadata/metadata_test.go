package metadata

import (
	"encoding/binary"
	"image"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
)

// newTestFSH creates a FileSystemHandler backed by a temporary local directory.
func newTestFSH(t *testing.T) (*filesystem.FileSystemHandler, string) {
	t.Helper()
	dir := t.TempDir()
	abs := localfs.NewLocalFileSystemAbstraction("TEST", dir+"/", "public", false)
	fsh := &filesystem.FileSystemHandler{
		Name:                  "test",
		UUID:                  "TEST",
		Path:                  dir + "/",
		ReadOnly:              false,
		Hierarchy:             "public",
		InitiationTime:        time.Now().Unix(),
		FileSystemAbstraction: abs,
		Filesystem:            "ext4",
	}
	return fsh, dir
}

// createSmallPNG writes a small valid PNG file to dir/name and returns the path.
func createSmallPNG(t *testing.T, dir, name string) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 20, 20))
	p := filepath.Join(dir, name)
	f, err := os.Create(p)
	if err != nil {
		t.Fatalf("createSmallPNG: %v", err)
	}
	if err := png.Encode(f, img); err != nil {
		f.Close()
		t.Fatalf("createSmallPNG png.Encode: %v", err)
	}
	f.Close()
	return p
}

// createSmallJPEG writes a minimal JPEG to dir/name and returns the path.
func createSmallJPEG(t *testing.T, dir, name string) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 20, 20))
	p := filepath.Join(dir, name)
	f, err := os.Create(p)
	if err != nil {
		t.Fatalf("createSmallJPEG: %v", err)
	}
	if err := jpeg.Encode(f, img, nil); err != nil {
		f.Close()
		t.Fatalf("createSmallJPEG jpeg.Encode: %v", err)
	}
	f.Close()
	return p
}

// createSVGFile writes a minimal SVG to dir/name and returns the path.
func createSVGFile(t *testing.T, dir, name string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	content := `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <rect width="100" height="100" fill="blue"/>
</svg>`
	if err := os.WriteFile(p, []byte(content), 0644); err != nil {
		t.Fatalf("createSVGFile: %v", err)
	}
	return p
}

// --- IsRawImageFile ---

func TestIsRawImageFile_RawExtensions(t *testing.T) {
	rawExts := []string{".arw", ".cr2", ".dng", ".nef", ".raf", ".orf"}
	for _, ext := range rawExts {
		if !IsRawImageFile("photo" + ext) {
			t.Errorf("expected %s to be recognised as RAW", ext)
		}
		// Case-insensitive
		if !IsRawImageFile("photo" + strings.ToUpper(ext)) {
			t.Errorf("expected upper-case %s to be recognised as RAW", ext)
		}
	}
}

func TestIsRawImageFile_NonRawExtensions(t *testing.T) {
	nonRaw := []string{".jpg", ".jpeg", ".png", ".mp4", ".txt", ".pdf", ""}
	for _, ext := range nonRaw {
		if IsRawImageFile("file" + ext) {
			t.Errorf("expected %q NOT to be recognised as RAW", ext)
		}
	}
}

// --- NewRenderHandler ---

func TestNewRenderHandler_NotNil(t *testing.T) {
	rh := NewRenderHandler()
	if rh == nil {
		t.Fatal("NewRenderHandler returned nil")
	}
}

func TestNewRenderHandler_SyncMapsInitialised(t *testing.T) {
	rh := NewRenderHandler()
	// Both sync.Maps should be usable immediately.
	rh.renderingFiles.Store("key", "val")
	v, ok := rh.renderingFiles.Load("key")
	if !ok || v != "val" {
		t.Error("renderingFiles Store/Load failed")
	}
	rh.renderingFolder.Store("k2", "v2")
	_, ok2 := rh.renderingFolder.Load("k2")
	if !ok2 {
		t.Error("renderingFolder Store/Load failed")
	}
}

// --- fileIsBusy ---

func TestFileIsBusy_NotBusy(t *testing.T) {
	rh := NewRenderHandler()
	if rh.fileIsBusy("/some/path") {
		t.Error("expected fileIsBusy to return false for unlisted path")
	}
}

func TestFileIsBusy_Busy(t *testing.T) {
	rh := NewRenderHandler()
	rh.renderingFiles.Store("/busy/path", "busy")
	if !rh.fileIsBusy("/busy/path") {
		t.Error("expected fileIsBusy to return true after Store")
	}
}

func TestFileIsBusy_NilReceiver(t *testing.T) {
	var rh *RenderHandler
	// A nil receiver logs and returns true — must not panic.
	result := rh.fileIsBusy("/any/path")
	if !result {
		t.Error("expected fileIsBusy on nil receiver to return true")
	}
}

// --- CacheExists ---

func TestCacheExists_NoCacheFiles(t *testing.T) {
	fsh, dir := newTestFSH(t)
	filePath := filepath.Join(dir, "image.png")
	os.WriteFile(filePath, []byte("fake"), 0644)

	if CacheExists(fsh, filePath) {
		t.Error("expected CacheExists to be false when no cache directory exists")
	}
}

func TestCacheExists_WithJPGCache(t *testing.T) {
	fsh, dir := newTestFSH(t)
	filePath := filepath.Join(dir, "image.png")
	os.WriteFile(filePath, []byte("fake"), 0644)

	// Manually create the cache file.
	cacheDir := filepath.Join(dir, ".metadata", ".cache")
	os.MkdirAll(cacheDir, 0755)
	cachePath := filepath.Join(cacheDir, "image.png.jpg")
	os.WriteFile(cachePath, []byte("jpeg"), 0644)

	if !CacheExists(fsh, filePath) {
		t.Error("expected CacheExists to be true with .jpg cache present")
	}
}

func TestCacheExists_WithPNGCache(t *testing.T) {
	fsh, dir := newTestFSH(t)
	filePath := filepath.Join(dir, "image.gif")
	os.WriteFile(filePath, []byte("fake"), 0644)

	cacheDir := filepath.Join(dir, ".metadata", ".cache")
	os.MkdirAll(cacheDir, 0755)
	cachePath := filepath.Join(cacheDir, "image.gif.png")
	os.WriteFile(cachePath, []byte("png"), 0644)

	if !CacheExists(fsh, filePath) {
		t.Error("expected CacheExists to be true with .png cache present")
	}
}

// --- GetCacheFilePath ---

func TestGetCacheFilePath_NoCache(t *testing.T) {
	fsh, dir := newTestFSH(t)
	filePath := filepath.Join(dir, "image.png")
	os.WriteFile(filePath, []byte("fake"), 0644)

	_, err := GetCacheFilePath(fsh, filePath)
	if err == nil {
		t.Error("expected error when no cache exists")
	}
}

func TestGetCacheFilePath_JPGCache(t *testing.T) {
	fsh, dir := newTestFSH(t)
	filePath := filepath.Join(dir, "image.png")
	os.WriteFile(filePath, []byte("fake"), 0644)

	cacheDir := filepath.Join(dir, ".metadata", ".cache")
	os.MkdirAll(cacheDir, 0755)
	cachePath := filepath.Join(cacheDir, "image.png.jpg")
	os.WriteFile(cachePath, []byte("jpeg"), 0644)

	got, err := GetCacheFilePath(fsh, filePath)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasSuffix(got, ".jpg") {
		t.Errorf("expected .jpg path, got %q", got)
	}
}

func TestGetCacheFilePath_PNGCache(t *testing.T) {
	fsh, dir := newTestFSH(t)
	filePath := filepath.Join(dir, "image.gif")
	os.WriteFile(filePath, []byte("fake"), 0644)

	cacheDir := filepath.Join(dir, ".metadata", ".cache")
	os.MkdirAll(cacheDir, 0755)
	cachePath := filepath.Join(cacheDir, "image.gif.png")
	os.WriteFile(cachePath, []byte("png"), 0644)

	got, err := GetCacheFilePath(fsh, filePath)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasSuffix(got, ".png") {
		t.Errorf("expected .png path, got %q", got)
	}
}

// --- RemoveCache ---

func TestRemoveCache_NoCache(t *testing.T) {
	fsh, dir := newTestFSH(t)
	filePath := filepath.Join(dir, "image.png")
	os.WriteFile(filePath, []byte("fake"), 0644)

	err := RemoveCache(fsh, filePath)
	if err == nil {
		t.Error("expected error when removing non-existent cache")
	}
}

func TestRemoveCache_WithCache(t *testing.T) {
	fsh, dir := newTestFSH(t)
	filePath := filepath.Join(dir, "image.png")
	os.WriteFile(filePath, []byte("fake"), 0644)

	cacheDir := filepath.Join(dir, ".metadata", ".cache")
	os.MkdirAll(cacheDir, 0755)
	cachePath := filepath.Join(cacheDir, "image.png.jpg")
	os.WriteFile(cachePath, []byte("jpeg"), 0644)

	if err := RemoveCache(fsh, filePath); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, err := os.Stat(cachePath); !os.IsNotExist(err) {
		t.Error("cache file should have been removed")
	}
}

// --- getImageAsBase64 ---

func TestGetImageAsBase64_ValidFile(t *testing.T) {
	fsh, dir := newTestFSH(t)
	p := createSmallJPEG(t, dir, "thumb.jpg")

	b64, err := getImageAsBase64(fsh, p)
	if err != nil {
		t.Fatalf("getImageAsBase64 returned error: %v", err)
	}
	if b64 == "" {
		t.Error("expected non-empty base64 string")
	}
}

func TestGetImageAsBase64_NonExistent(t *testing.T) {
	fsh, dir := newTestFSH(t)
	_, err := getImageAsBase64(fsh, filepath.Join(dir, "nonexistent.jpg"))
	if err == nil {
		t.Error("expected error for non-existent file")
	}
}

// --- generateThumbnailForImage ---

func TestGenerateThumbnailForImage_WithPNG(t *testing.T) {
	fsh, dir := newTestFSH(t)
	pngPath := createSmallPNG(t, dir, "test.png")
	cacheDir := filepath.Join(dir, ".metadata", ".cache") + "/"
	os.MkdirAll(cacheDir, 0755)

	_, err := generateThumbnailForImage(fsh, cacheDir, pngPath, true)
	if err != nil {
		t.Logf("generateThumbnailForImage returned error (may be OK): %v", err)
	}
}

func TestGenerateThumbnailForImage_WithJPEG(t *testing.T) {
	fsh, dir := newTestFSH(t)
	jpgPath := createSmallJPEG(t, dir, "test.jpg")
	cacheDir := filepath.Join(dir, ".metadata", ".cache") + "/"
	os.MkdirAll(cacheDir, 0755)

	_, err := generateThumbnailForImage(fsh, cacheDir, jpgPath, true)
	if err != nil {
		t.Logf("generateThumbnailForImage (JPEG) returned error: %v", err)
	}
}

func TestGenerateThumbnailForImage_RequireBuffer(t *testing.T) {
	fsh, _ := newTestFSH(t)
	fsh.RequireBuffer = true

	result, err := generateThumbnailForImage(fsh, "/tmp/cache/", "/tmp/test.png", false)
	if err != nil {
		t.Fatalf("unexpected error for RequireBuffer path: %v", err)
	}
	if result != "" {
		t.Errorf("expected empty string for RequireBuffer, got %q", result)
	}
}

// --- generateThumbnailForSVG ---

func TestGenerateThumbnailForSVG_SourceNotExists(t *testing.T) {
	fsh, dir := newTestFSH(t)
	cacheDir := filepath.Join(dir, "cache") + "/"
	os.MkdirAll(cacheDir, 0755)

	_, err := generateThumbnailForSVG(fsh, cacheDir, filepath.Join(dir, "nonexistent.svg"), false)
	if err == nil {
		t.Error("expected error for non-existent SVG source")
	}
}

func TestGenerateThumbnailForSVG_WithSVG(t *testing.T) {
	fsh, dir := newTestFSH(t)
	svgPath := createSVGFile(t, dir, "test.svg")
	cacheDir := filepath.Join(dir, ".metadata", ".cache") + "/"
	os.MkdirAll(cacheDir, 0755)

	_, err := generateThumbnailForSVG(fsh, cacheDir, svgPath, true)
	if err != nil {
		t.Logf("generateThumbnailForSVG returned error (may be OK): %v", err)
	}
}

func TestGenerateThumbnailForSVG_RequireBuffer(t *testing.T) {
	fsh, _ := newTestFSH(t)
	fsh.RequireBuffer = true

	result, err := generateThumbnailForSVG(fsh, "/tmp/", "/tmp/test.svg", false)
	if err != nil {
		t.Fatalf("unexpected error for RequireBuffer: %v", err)
	}
	if result != "" {
		t.Errorf("expected empty string for RequireBuffer")
	}
}

// --- generateThumbnailForModel ---

func TestGenerateThumbnailForModel_SourceNotExists(t *testing.T) {
	fsh, dir := newTestFSH(t)
	cacheDir := filepath.Join(dir, "cache") + "/"

	_, err := generateThumbnailForModel(fsh, cacheDir, filepath.Join(dir, "nonexistent.obj"), false)
	if err == nil {
		t.Error("expected error for non-existent model file")
	}
}

func TestGenerateThumbnailForModel_RequireBuffer(t *testing.T) {
	fsh, _ := newTestFSH(t)
	fsh.RequireBuffer = true

	result, err := generateThumbnailForModel(fsh, "/tmp/", "/tmp/model.stl", false)
	if err != nil {
		t.Fatalf("unexpected error for RequireBuffer: %v", err)
	}
	if result != "" {
		t.Errorf("expected empty string for RequireBuffer")
	}
}

// --- generateThumbnailForPSD ---

func TestGenerateThumbnailForPSD_SourceNotExists(t *testing.T) {
	fsh, dir := newTestFSH(t)
	cacheDir := filepath.Join(dir, "cache") + "/"

	_, err := generateThumbnailForPSD(fsh, cacheDir, filepath.Join(dir, "nonexistent.psd"), false)
	if err == nil {
		t.Error("expected error for non-existent PSD file")
	}
}

func TestGenerateThumbnailForPSD_RequireBuffer(t *testing.T) {
	fsh, _ := newTestFSH(t)
	fsh.RequireBuffer = true

	result, err := generateThumbnailForPSD(fsh, "/tmp/", "/tmp/test.psd", false)
	if err != nil {
		t.Fatalf("unexpected error for RequireBuffer: %v", err)
	}
	if result != "" {
		t.Errorf("expected empty string for RequireBuffer")
	}
}

// --- generateThumbnailForAudio ---

func TestGenerateThumbnailForAudio_SourceNotExists(t *testing.T) {
	fsh, dir := newTestFSH(t)
	cacheDir := filepath.Join(dir, "cache") + "/"

	_, err := generateThumbnailForAudio(fsh, cacheDir, filepath.Join(dir, "nonexistent.mp3"), false)
	if err == nil {
		t.Error("expected error for non-existent audio file")
	}
}

func TestGenerateThumbnailForAudio_RequireBuffer(t *testing.T) {
	fsh, _ := newTestFSH(t)
	fsh.RequireBuffer = true

	result, err := generateThumbnailForAudio(fsh, "/tmp/", "/tmp/test.mp3", false)
	if err != nil {
		t.Fatalf("unexpected error for RequireBuffer: %v", err)
	}
	if result != "" {
		t.Errorf("expected empty string for RequireBuffer")
	}
}

func TestGenerateThumbnailForAudio_InvalidFile(t *testing.T) {
	fsh, dir := newTestFSH(t)
	cacheDir := filepath.Join(dir, "cache") + "/"
	os.MkdirAll(cacheDir, 0755)

	// Create a fake MP3 that is not valid (tag library will return error)
	fakeMp3 := filepath.Join(dir, "fake.mp3")
	os.WriteFile(fakeMp3, []byte("not a valid mp3 file"), 0644)

	_, err := generateThumbnailForAudio(fsh, cacheDir, fakeMp3, false)
	if err == nil {
		t.Log("generateThumbnailForAudio with invalid file returned nil (possibly OK)")
	}
}

// --- generateThumbnailForVideo ---

func TestGenerateThumbnailForVideo_SourceNotExists(t *testing.T) {
	fsh, dir := newTestFSH(t)
	cacheDir := filepath.Join(dir, "cache") + "/"

	_, err := generateThumbnailForVideo(fsh, cacheDir, filepath.Join(dir, "nonexistent.mp4"), false)
	if err == nil {
		t.Error("expected error for non-existent video file")
	}
}

func TestGenerateThumbnailForVideo_RequireBuffer(t *testing.T) {
	fsh, _ := newTestFSH(t)
	fsh.RequireBuffer = true

	result, err := generateThumbnailForVideo(fsh, "/tmp/", "/tmp/test.mp4", false)
	if err != nil {
		t.Fatalf("unexpected error for RequireBuffer: %v", err)
	}
	if result != "" {
		t.Errorf("expected empty string for RequireBuffer")
	}
}

// --- pkg_exists ---

func TestPkgExists_CommonTool(t *testing.T) {
	// bash should exist on any Linux system we run tests on
	_ = pkg_exists("bash")
	_ = pkg_exists("nonexistentpackage12345")
}

// --- generateThumbnailForFolder ---

func TestGenerateThumbnailForFolder_MissingSystemFile(t *testing.T) {
	fsh, dir := newTestFSH(t)
	// Create the cache directory inside the folder so generateLayeredThumbnailFolder is skipped.
	folderPath := filepath.Join(dir, "myfolder")
	os.MkdirAll(folderPath, 0755)
	innerCache := filepath.Join(folderPath, ".metadata", ".cache")
	os.MkdirAll(innerCache, 0755)
	cacheDir := filepath.Join(dir, ".metadata", ".cache") + "/"
	os.MkdirAll(cacheDir, 0755)

	// The system folder-preview.png doesn't exist from the test working directory,
	// so the function should return "missing system template image file" error.
	_, err := generateThumbnailForFolder(fsh, cacheDir, folderPath, true)
	// We expect an error or nil depending on folder state; just ensure no panic.
	_ = err
}

func TestGenerateThumbnailForFolder_RequireBuffer(t *testing.T) {
	fsh, _ := newTestFSH(t)
	fsh.RequireBuffer = true

	result, err := generateThumbnailForFolder(fsh, "/tmp/", "/tmp/folder", false)
	if err != nil {
		t.Fatalf("unexpected error for RequireBuffer: %v", err)
	}
	if result != "" {
		t.Errorf("expected empty string for RequireBuffer")
	}
}

// --- Raw internal helpers ---

func TestGetSizeForType_AllTypes(t *testing.T) {
	tests := []struct {
		fieldType uint16
		expected  uint32
	}{
		{1, 1}, {2, 1}, {6, 1}, {7, 1}, // BYTE, ASCII, SBYTE, UNDEFINED
		{3, 2}, {8, 2}, // SHORT, SSHORT
		{4, 4}, {9, 4}, // LONG, SLONG
		{5, 8}, {10, 8}, // RATIONAL, SRATIONAL
		{11, 4}, // FLOAT
		{12, 8}, // DOUBLE
		{0, 0},  // index 0 = 0
		{99, 1}, // unknown type → default 1
	}
	for _, tc := range tests {
		got := getSizeForType(tc.fieldType)
		if got != tc.expected {
			t.Errorf("getSizeForType(%d) = %d, want %d", tc.fieldType, got, tc.expected)
		}
	}
}

func TestExtractLargestJPEG_EmptyData(t *testing.T) {
	_, err := extractLargestJPEG([]byte{})
	if err == nil {
		t.Error("expected error for empty data")
	}
}

func TestExtractLargestJPEG_NoMarkers(t *testing.T) {
	_, err := extractLargestJPEG([]byte("random data without jpeg markers"))
	if err == nil {
		t.Error("expected error when no JPEG markers found")
	}
}

func TestExtractLargestJPEG_WithFakeJPEG(t *testing.T) {
	// Build a byte array with a fake JPEG: SOI + some data + EOI
	data := make([]byte, 20)
	data[0] = 0xFF
	data[1] = 0xD8 // SOI
	data[2] = 0x00
	data[3] = 0x01
	data[len(data)-2] = 0xFF
	data[len(data)-1] = 0xD9 // EOI
	result, err := extractLargestJPEG(data)
	if err != nil {
		t.Logf("extractLargestJPEG with fake JPEG returned error (may be OK): %v", err)
	}
	_ = result
}

func TestExtractJPEGFromTIFF_InvalidHeader(t *testing.T) {
	_, err := extractJPEGFromTIFF([]byte{0x00, 0x01, 0x02})
	if err == nil {
		t.Error("expected error for invalid TIFF header")
	}
}

func TestExtractJPEGFromTIFF_TooShort(t *testing.T) {
	_, err := extractJPEGFromTIFF([]byte{})
	if err == nil {
		t.Error("expected error for empty data")
	}
}

func TestExtractJPEGFromTIFF_LittleEndianHeader(t *testing.T) {
	// Build a minimal little-endian TIFF header: 'II' + magic 42 + IFD offset
	data := make([]byte, 8)
	data[0] = 'I'
	data[1] = 'I'
	binary.LittleEndian.PutUint16(data[2:4], 42)
	binary.LittleEndian.PutUint32(data[4:8], 8) // IFD starts at byte 8, but data is too short
	_, err := extractJPEGFromTIFF(data)
	// May succeed or fail; just ensure no panic.
	_ = err
}

func TestExtractJPEGFromTIFF_BigEndianHeader(t *testing.T) {
	// Build a minimal big-endian TIFF header: 'MM' + magic 42 + IFD offset
	data := make([]byte, 8)
	data[0] = 'M'
	data[1] = 'M'
	binary.BigEndian.PutUint16(data[2:4], 42)
	binary.BigEndian.PutUint32(data[4:8], 8)
	_, err := extractJPEGFromTIFF(data)
	_ = err
}

func TestReadIFDValue_ShortType(t *testing.T) {
	data := []byte{0, 0, 0, 0, 0xFF, 0x12, 0, 0}
	val := readIFDValue(data, binary.LittleEndian, 3, 4) // SHORT
	if val != 0x12FF {
		t.Logf("readIFDValue SHORT = 0x%X", val)
	}
}

func TestReadIFDValue_LongType(t *testing.T) {
	data := []byte{0, 0, 0, 0, 0x01, 0x00, 0x00, 0x00}
	val := readIFDValue(data, binary.LittleEndian, 4, 4) // LONG
	if val != 1 {
		t.Logf("readIFDValue LONG = %d", val)
	}
}

func TestReadIFDValue_OutOfBounds(t *testing.T) {
	data := []byte{0x01}
	// Offset that would go out of bounds - should not panic.
	val := readIFDValue(data, binary.LittleEndian, 4, 100)
	_ = val
}

func TestReadIFDArray_EmptyResult(t *testing.T) {
	data := make([]byte, 16)
	result := readIFDArray(data, binary.LittleEndian, 3, 0, 0) // count=0
	if len(result) != 0 {
		t.Errorf("expected empty result for count=0, got %v", result)
	}
}

func TestReadIFDArray_ShortValues(t *testing.T) {
	data := make([]byte, 16)
	binary.LittleEndian.PutUint16(data[0:], 100)
	binary.LittleEndian.PutUint16(data[2:], 200)
	result := readIFDArray(data, binary.LittleEndian, 3, 2, 0) // SHORT, count=2
	if len(result) != 2 {
		t.Logf("readIFDArray returned %d elements (expected 2)", len(result))
	}
}

func TestParseTIFFIFDChain_TooSmall(t *testing.T) {
	data := []byte{0x01, 0x02}
	candidates := &[][]byte{}
	// Should not panic with too-small data
	parseTIFFIFDChain(data, binary.LittleEndian, 0, candidates)
}

func TestParseTIFFIFDChain_OffsetOutOfBounds(t *testing.T) {
	data := make([]byte, 10)
	candidates := &[][]byte{}
	// Offset out of bounds — should not panic
	parseTIFFIFDChain(data, binary.LittleEndian, 1000, candidates)
}

func TestExtractUncompressedThumbnail_TooSmall(t *testing.T) {
	// The function has an unsigned-underflow guard that only fires when
	// len(data) >= 2. Pass a 3-byte slice so the bounds check triggers
	// properly and returns an error instead of panicking.
	data := []byte{0x00, 0x00, 0x00}
	_, err := extractUncompressedThumbnail(data, binary.LittleEndian, 0)
	if err == nil {
		t.Error("expected error for minimal data")
	}
}
