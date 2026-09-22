package storage

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"imuslab.com/arozos/mod/filesystem/arozfs"
)

// countingRenderer renders "thumb:<file name>" and counts its calls. Files
// named none.* have no thumbnail.
func countingRenderer(calls *int32) func(string) ([]byte, error) {
	return func(osPath string) ([]byte, error) {
		atomic.AddInt32(calls, 1)
		if _, err := os.Stat(osPath); err != nil {
			return nil, err
		}
		name := filepath.Base(osPath)
		if name == "none.png" {
			return nil, arozfs.ErrNoThumbnail
		}
		return []byte("thumb:" + name), nil
	}
}

func TestThumbnailRenderedByHolder(t *testing.T) {
	a, b := cluster2(t)
	var aCalls, bCalls int32
	a.thumb.Store(countingRenderer(&aCalls))
	b.thumb.Store(countingRenderer(&bCalls))

	for _, p := range []string{"/pics/a.png", "/pics/none.png"} {
		if err := a.svc.Write(p, bytes.NewReader([]byte("image")), ""); err != nil {
			t.Fatalf("write %s: %v", p, err)
		}
	}
	if err := a.svc.Mkdir("/pics/sub", ""); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	waitFor(t, "b to see the files", 5*time.Second, func() bool {
		_, err := b.meta.Stat("/pics/none.png")
		return err == nil
	})

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	testcases := []struct {
		name     string
		node     *testNode
		path     string
		want     string
		wantErr  error
		aRenders int32
		bRenders int32
	}{
		//The holder renders its own copy without any request
		{name: "local copy", node: a, path: "/pics/a.png", want: "thumb:a.png", aRenders: 1},
		//b holds no copy: a renders it and only the image comes back
		{name: "remote copy", node: b, path: "/pics/a.png", want: "thumb:a.png", aRenders: 2},
		//No thumbnail is an answer about the content and comes back as such
		{name: "no thumbnail remote", node: b, path: "/pics/none.png", wantErr: arozfs.ErrNoThumbnail, aRenders: 3},
		{name: "no thumbnail local", node: a, path: "/pics/none.png", wantErr: arozfs.ErrNoThumbnail, aRenders: 4},
		//Folders and missing files never reach a renderer
		{name: "folder", node: b, path: "/pics/sub", wantErr: arozfs.ErrNoThumbnail, aRenders: 4},
		{name: "missing", node: b, path: "/pics/missing.png", wantErr: os.ErrNotExist, aRenders: 4},
	}
	for _, tc := range testcases {
		data, err := tc.node.svc.Thumbnail(ctx, tc.path, "")
		if tc.wantErr != nil {
			if !errors.Is(err, tc.wantErr) {
				t.Errorf("%s: expected %v, got %v (%q)", tc.name, tc.wantErr, err, data)
			}
		} else if err != nil || string(data) != tc.want {
			t.Errorf("%s: got %q, %v; wanted %q", tc.name, data, err, tc.want)
		}
		if got := atomic.LoadInt32(&aCalls); got != tc.aRenders {
			t.Errorf("%s: a rendered %d times in total, wanted %d", tc.name, got, tc.aRenders)
		}
		if got := atomic.LoadInt32(&bCalls); got != tc.bRenders {
			t.Errorf("%s: b rendered %d times in total, wanted %d", tc.name, got, tc.bRenders)
		}
	}
}

func TestThumbnailHolderLimits(t *testing.T) {
	a, b := cluster2(t)
	if err := a.svc.Write("/v/clip.mp4", bytes.NewReader([]byte("video")), ""); err != nil {
		t.Fatalf("write: %v", err)
	}
	waitFor(t, "b to see the file", 5*time.Second, func() bool {
		_, err := b.meta.Stat("/v/clip.mp4")
		return err == nil
	})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	//The only holder has no renderer: a failure, but not "no thumbnail",
	//since another node could still render it later
	_, err := b.svc.Thumbnail(ctx, "/v/clip.mp4", "")
	if err == nil || errors.Is(err, arozfs.ErrNoThumbnail) {
		t.Errorf("a holder without a renderer should fail with a retryable error, got %v", err)
	}

	//A holder that lacks the tool the format needs is not asked at all
	var calls int32
	a.thumb.Store(countingRenderer(&calls))
	if _, err := b.svc.Thumbnail(ctx, "/v/clip.mp4", "no-such-feature"); !errors.Is(err, ErrNoThumbnailHolder) {
		t.Errorf("expected ErrNoThumbnailHolder, got %v", err)
	}
	if atomic.LoadInt32(&calls) != 0 {
		t.Errorf("a holder without the feature was asked to render")
	}

	//An oversized thumbnail is refused rather than passed on
	a.thumb.Store(func(string) ([]byte, error) { return make([]byte, MaxThumbnailBytes+1), nil })
	if _, err := a.svc.Thumbnail(ctx, "/v/clip.mp4", ""); err == nil {
		t.Error("an oversized thumbnail should be refused")
	}
}
