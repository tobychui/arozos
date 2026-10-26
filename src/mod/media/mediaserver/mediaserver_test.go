package mediaserver

import (
	"errors"
	"testing"

	fs "imuslab.com/arozos/mod/filesystem"
)

// TestNewMediaServer verifies that NewMediaServer returns a non-nil Instance
// with a properly stored options reference and a default (non-nil)
// VirtualPathResolver.
func TestNewMediaServer(t *testing.T) {
	opts := &Options{
		BufferPoolSize:      100,
		BufferFileMaxSize:   10,
		EnableFileBuffering: false,
		TmpDirectory:        t.TempDir(),
		// Authagent, UserHandler, Logger intentionally left nil for this
		// constructor-only test.
	}

	srv := NewMediaServer(opts)
	if srv == nil {
		t.Fatal("expected NewMediaServer to return a non-nil *Instance")
	}
	if srv.options != opts {
		t.Error("expected options to be stored in the returned Instance")
	}
	if srv.VirtualPathResolver == nil {
		t.Error("expected a default VirtualPathResolver to be set")
	}
}

// TestNewMediaServer_DefaultResolverReturnsError verifies that the default
// VirtualPathResolver always returns an error (no real resolver is wired up).
func TestNewMediaServer_DefaultResolverReturnsError(t *testing.T) {
	srv := NewMediaServer(&Options{TmpDirectory: t.TempDir()})

	_, _, err := srv.VirtualPathResolver("user://some/path")
	if err == nil {
		t.Error("expected default VirtualPathResolver to return an error")
	}
}

// TestSetVirtualPathResolver verifies that SetVirtualPathResolver replaces the
// existing resolver with the provided function.
func TestSetVirtualPathResolver(t *testing.T) {
	srv := NewMediaServer(&Options{TmpDirectory: t.TempDir()})

	sentinelErr := errors.New("custom resolver called")
	srv.SetVirtualPathResolver(func(s string) (*fs.FileSystemHandler, string, error) {
		return nil, "", sentinelErr
	})

	if srv.VirtualPathResolver == nil {
		t.Fatal("expected VirtualPathResolver to be non-nil after SetVirtualPathResolver")
	}

	_, _, err := srv.VirtualPathResolver("any/path")
	if err != sentinelErr {
		t.Errorf("expected sentinel error from custom resolver, got: %v", err)
	}
}

// TestOptions_Fields verifies that all Options fields are stored correctly.
func TestOptions_Fields(t *testing.T) {
	tmpDir := t.TempDir()
	opts := &Options{
		BufferPoolSize:      256,
		BufferFileMaxSize:   64,
		EnableFileBuffering: true,
		TmpDirectory:        tmpDir,
	}

	if opts.BufferPoolSize != 256 {
		t.Errorf("unexpected BufferPoolSize: %d", opts.BufferPoolSize)
	}
	if opts.BufferFileMaxSize != 64 {
		t.Errorf("unexpected BufferFileMaxSize: %d", opts.BufferFileMaxSize)
	}
	if !opts.EnableFileBuffering {
		t.Error("expected EnableFileBuffering to be true")
	}
	if opts.TmpDirectory != tmpDir {
		t.Errorf("unexpected TmpDirectory: %s", opts.TmpDirectory)
	}
}
