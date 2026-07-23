package git

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPreviewMimeType(t *testing.T) {
	tests := []struct {
		name string
		path string
		want string
	}{
		{name: "png", path: "img/icon.png", want: "image/png"},
		{name: "jpg", path: "photo.jpg", want: "image/jpeg"},
		{name: "jpeg", path: "photo.jpeg", want: "image/jpeg"},
		{name: "uppercase extension", path: "PHOTO.JPG", want: "image/jpeg"},
		{name: "gif", path: "a.gif", want: "image/gif"},
		{name: "webp", path: "a.webp", want: "image/webp"},
		{name: "svg", path: "a.svg", want: "image/svg+xml"},
		{name: "pdf", path: "docs/manual.pdf", want: "application/pdf"},
		{name: "mp4", path: "clip.mp4", want: "video/mp4"},
		{name: "webm", path: "clip.webm", want: "video/webm"},
		{name: "mp3", path: "song.mp3", want: "audio/mpeg"},
		{name: "flac", path: "song.flac", want: "audio/flac"},
		{name: "go source", path: "main.go", want: ""},
		{name: "no extension", path: "Makefile", want: ""},
		{name: "dotfile", path: ".gitignore", want: ""},
		{name: "unknown extension", path: "a.xyz", want: ""},
		{name: "double extension uses the last", path: "archive.png.gz", want: ""},
		{name: "path with folders", path: "a/b/c/photo.png", want: "image/png"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := PreviewMimeType(test.path); got != test.want {
				t.Errorf("PreviewMimeType(%q) = %q, want %q", test.path, got, test.want)
			}
		})
	}
}

func TestPreviewKind(t *testing.T) {
	tests := []struct {
		name string
		path string
		want string
	}{
		{name: "png is an image", path: "a.png", want: "image"},
		{name: "svg is an image", path: "a.svg", want: "image"},
		{name: "pdf is its own kind", path: "a.pdf", want: "pdf"},
		{name: "mp4 is video", path: "a.mp4", want: "video"},
		{name: "mp3 is audio", path: "a.mp3", want: "audio"},
		{name: "source file has no preview", path: "a.go", want: ""},
		{name: "no extension", path: "LICENSE", want: ""},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := PreviewKind(test.path); got != test.want {
				t.Errorf("PreviewKind(%q) = %q, want %q", test.path, got, test.want)
			}
		})
	}
}

func TestFileBlobAtHead(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "committed content\n", "first")

	//Change the working tree: the blob must still be the committed version
	writeFile(t, repoPath, "a.txt", "working tree content\n")

	content, exists, err := manager.FileBlob(repoPath, "a.txt", "HEAD")
	if err != nil {
		t.Fatalf("FileBlob() returned error: %v", err)
	}
	if !exists {
		t.Fatalf("exists = false for a committed file, want true")
	}
	if string(content) != "committed content\n" {
		t.Errorf("FileBlob() = %q, want the committed content", string(content))
	}
}

func TestFileBlobRevisionForms(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	first := commitFile(t, manager, repoPath, "a.txt", "one\n", "first")
	commitFile(t, manager, repoPath, "a.txt", "two\n", "second")

	tests := []struct {
		name     string
		revision string
		want     string
	}{
		{name: "explicit HEAD", revision: "HEAD", want: "two\n"},
		{name: "lowercase head", revision: "head", want: "two\n"},
		{name: "empty means HEAD", revision: "", want: "two\n"},
		{name: "whitespace means HEAD", revision: "   ", want: "two\n"},
		{name: "explicit commit hash", revision: first, want: "one\n"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			content, exists, err := manager.FileBlob(repoPath, "a.txt", test.revision)
			if err != nil {
				t.Fatalf("FileBlob(%q) returned error: %v", test.revision, err)
			}
			if !exists {
				t.Fatalf("exists = false, want true")
			}
			if string(content) != test.want {
				t.Errorf("FileBlob(%q) = %q, want %q", test.revision, string(content), test.want)
			}
		})
	}
}

func TestFileBlobMissingPathIsNotAnError(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	content, exists, err := manager.FileBlob(repoPath, "never-committed.png", "HEAD")
	if err != nil {
		t.Fatalf("FileBlob() on a missing path returned error: %v", err)
	}
	if exists {
		t.Errorf("exists = true for a path that was never committed, want false")
	}
	if content != nil {
		t.Errorf("content = %q, want nil", string(content))
	}
}

func TestFileBlobOnUnbornBranch(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	writeFile(t, repoPath, "new.png", "not committed yet")

	content, exists, err := manager.FileBlob(repoPath, "new.png", "HEAD")
	if err != nil {
		t.Fatalf("FileBlob() on an unborn branch returned error: %v", err)
	}
	if exists {
		t.Errorf("exists = true before any commit, want false")
	}
	if content != nil {
		t.Errorf("content = %q, want nil", string(content))
	}
}

func TestFileBlobValidation(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	tests := []struct {
		name     string
		path     string
		file     string
		revision string
	}{
		{name: "not a repository", path: t.TempDir(), file: "a.txt", revision: "HEAD"},
		{name: "escaping path", path: repoPath, file: "../../secret.txt", revision: "HEAD"},
		{name: "absolute path", path: repoPath, file: "/absolute/a.txt", revision: "HEAD"},
		{name: "empty file", path: repoPath, file: "", revision: "HEAD"},
		{name: "short hash rejected", path: repoPath, file: "a.txt", revision: "abc1234"},
		{name: "non hex revision", path: repoPath, file: "a.txt", revision: "not-a-hash"},
		{name: "branch name rejected", path: repoPath, file: "a.txt", revision: "master"},
		{name: "unknown commit", path: repoPath, file: "a.txt", revision: strings.Repeat("a", 40)},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, _, err := manager.FileBlob(test.path, test.file, test.revision); err == nil {
				t.Errorf("FileBlob() with %s = nil error, want an error", test.name)
			}
		})
	}
}

// TestFileBlobBinaryRoundTrip makes sure image bytes survive intact — a preview
// is worthless if the content is mangled on the way out.
func TestFileBlobBinaryRoundTrip(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)

	//A tiny valid PNG header followed by bytes that would break text handling
	original := []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0xFF, 0xFE, 0x00, 0x0D}
	if err := os.WriteFile(filepath.Join(repoPath, "icon.png"), original, 0664); err != nil {
		t.Fatalf("cannot write the binary file: %v", err)
	}
	if _, err := manager.Commit(repoPath, &CommitRequest{
		Message: "add icon",
		Files:   []string{"icon.png"},
		Name:    "Test User",
		Email:   "test@arozos.local",
	}); err != nil {
		t.Fatalf("Commit() returned error: %v", err)
	}

	content, exists, err := manager.FileBlob(repoPath, "icon.png", "HEAD")
	if err != nil {
		t.Fatalf("FileBlob() returned error: %v", err)
	}
	if !exists {
		t.Fatalf("exists = false, want true")
	}
	if len(content) != len(original) {
		t.Fatalf("FileBlob() returned %d bytes, want %d", len(content), len(original))
	}
	for i := range original {
		if content[i] != original[i] {
			t.Fatalf("byte %d = %#x, want %#x", i, content[i], original[i])
		}
	}
}

// TestFileBlobFromSubfolderPath checks a path inside the repository resolves to
// the same repository, matching every other Manager call.
func TestFileBlobFromSubfolderPath(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "img/icon.png", "content", "add icon")

	nested := filepath.Join(repoPath, "img")
	content, exists, err := manager.FileBlob(nested, "img/icon.png", "HEAD")
	if err != nil {
		t.Fatalf("FileBlob() returned error: %v", err)
	}
	if !exists || string(content) != "content" {
		t.Errorf("FileBlob() = %q (exists %v), want the committed content", string(content), exists)
	}
}
