package s3fs

import (
	"os"
	"testing"
	"time"
)

// fakeClock lets a test move time instead of sleeping.
type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time          { return c.t }
func (c *fakeClock) add(d time.Duration)     { c.t = c.t.Add(d) }
func newTestCache() (*statCache, *fakeClock) { return newTestCacheTTL(10 * time.Second) }

func newTestCacheTTL(ttl time.Duration) (*statCache, *fakeClock) {
	clock := &fakeClock{t: time.Date(2026, 11, 9, 12, 0, 0, 0, time.UTC)}
	c := newStatCache(ttl)
	c.now = clock.now
	return c, clock
}

func fileInfo(name string, size int64) os.FileInfo {
	return NewS3FileInfo(name, size, false, time.Unix(0, 0))
}

func TestParentAndChildKey(t *testing.T) {
	cases := []struct {
		key, parent string
	}{
		{"a.txt", ""},
		{"photos/a.jpg", "photos"},
		{"prefix/photos/2026/a.jpg", "prefix/photos/2026"},
		{"", ""},
	}
	for _, tc := range cases {
		if got := parentKey(tc.key); got != tc.parent {
			t.Errorf("parentKey(%q) = %q, want %q", tc.key, got, tc.parent)
		}
	}
	if got := childKey("", "a.txt"); got != "a.txt" {
		t.Errorf("childKey at the root = %q, want a.txt", got)
	}
	if got := childKey("photos", "a.jpg"); got != "photos/a.jpg" {
		t.Errorf("childKey(photos, a.jpg) = %q", got)
	}
}

func TestStatCacheKeepsAnswersUntilTheyExpire(t *testing.T) {
	c, clock := newTestCache()
	if _, known := c.get("a.txt"); known {
		t.Fatalf("an empty cache claims to know a.txt")
	}
	c.put(c.generation(), "a.txt", fileInfo("a.txt", 5))
	c.put(c.generation(), "gone.txt", nil)

	info, known := c.get("a.txt")
	if !known || info == nil || info.Size() != 5 {
		t.Fatalf("get(a.txt) = %v, %v, want the stored file", info, known)
	}
	if info, known := c.get("gone.txt"); !known || info != nil {
		t.Fatalf("get(gone.txt) = %v, %v, want known missing", info, known)
	}

	clock.add(10 * time.Second)
	if _, known := c.get("a.txt"); known {
		t.Errorf("a.txt is still known after its lifetime")
	}
	if _, known := c.get("gone.txt"); known {
		t.Errorf("gone.txt is still known missing after its lifetime")
	}
}

func TestStatCacheListingAnswersForMissingNames(t *testing.T) {
	c, clock := newTestCache()
	c.putListing(c.generation(), "photos", map[string]os.FileInfo{
		"a.jpg": fileInfo("a.jpg", 1),
		"2026":  NewS3FileInfo("2026", 0, true, time.Unix(0, 0)),
	})

	cases := []struct {
		key     string
		known   bool
		present bool
	}{
		{"photos/a.jpg", true, true},
		{"photos/2026", true, true},
		{"photos/desktop.ini", true, false}, //Not in a complete listing
		{"photos/2026/b.jpg", false, false}, //Below a folder that was not listed
		{"other/a.jpg", false, false},
	}
	for _, tc := range cases {
		info, known := c.get(tc.key)
		if known != tc.known || (info != nil) != tc.present {
			t.Errorf("get(%q) = present %v known %v, want present %v known %v", tc.key, info != nil, known, tc.present, tc.known)
		}
	}

	clock.add(11 * time.Second)
	if _, known := c.get("photos/desktop.ini"); known {
		t.Errorf("an expired listing still answers for a missing name")
	}
}

func TestStatCacheRootListing(t *testing.T) {
	c, _ := newTestCache()
	c.putListing(c.generation(), "", map[string]os.FileInfo{"a.txt": fileInfo("a.txt", 1)})
	if info, known := c.get("a.txt"); !known || info == nil {
		t.Errorf("get(a.txt) after a root listing = %v, %v", info, known)
	}
	if info, known := c.get("b.txt"); !known || info != nil {
		t.Errorf("get(b.txt) after a root listing = %v, %v, want known missing", info, known)
	}
}

func TestStatCacheChangeDropsPathAndFoldersAbove(t *testing.T) {
	c, _ := newTestCache()
	gen := c.generation()
	c.putListing(gen, "", map[string]os.FileInfo{"photos": NewS3FileInfo("photos", 0, true, time.Unix(0, 0))})
	c.putListing(gen, "photos", map[string]os.FileInfo{"a.jpg": fileInfo("a.jpg", 1)})
	c.put(gen, "photos/new.jpg", nil)
	c.put(gen, "docs/x.txt", fileInfo("x.txt", 1))

	c.changed("photos/new.jpg")

	for _, key := range []string{"photos/new.jpg", "photos", "photos/missing.jpg"} {
		if _, known := c.get(key); known {
			t.Errorf("get(%q) is still answered from the cache after photos/new.jpg changed", key)
		}
	}
	//Unrelated entries stay
	if info, known := c.get("docs/x.txt"); !known || info == nil {
		t.Errorf("docs/x.txt was dropped by a change in photos")
	}
	if info, known := c.get("photos/a.jpg"); !known || info == nil {
		t.Errorf("photos/a.jpg was dropped although only new.jpg changed")
	}
}

func TestStatCacheDropsLookupsOlderThanAChange(t *testing.T) {
	c, _ := newTestCache()
	gen := c.generation() //A lookup starts
	c.changed("a.txt")    //The file is written while it waits for the bucket
	c.put(gen, "a.txt", nil)
	c.putListing(gen, "", map[string]os.FileInfo{})
	if _, known := c.get("a.txt"); known {
		t.Fatalf("an answer from before the write was kept")
	}

	gen = c.generation()
	c.clear()
	c.put(gen, "b.txt", fileInfo("b.txt", 1))
	if _, known := c.get("b.txt"); known {
		t.Fatalf("an answer from before a clear was kept")
	}
}

func TestStatCacheClear(t *testing.T) {
	c, _ := newTestCache()
	c.put(c.generation(), "a.txt", fileInfo("a.txt", 1))
	c.putListing(c.generation(), "photos", map[string]os.FileInfo{})
	c.clear()
	if _, known := c.get("a.txt"); known {
		t.Errorf("a.txt survived clear")
	}
	if _, known := c.get("photos/x"); known {
		t.Errorf("the photos listing survived clear")
	}
}

func TestStatCacheStaysBounded(t *testing.T) {
	c, clock := newTestCache()
	gen := c.generation()
	for i := 0; i < statCacheMax; i++ {
		c.put(gen, childKey("old", string(rune('a'+i%26))+time.Duration(i).String()), nil)
	}
	clock.add(time.Minute) //All of them expired
	c.put(gen, "fresh.txt", fileInfo("fresh.txt", 1))
	if len(c.entries) != 1 {
		t.Fatalf("%d entries after expired ones should have been dropped, want 1", len(c.entries))
	}

	for i := 0; i < statCacheMax; i++ {
		c.put(gen, childKey("live", time.Duration(i).String()), nil)
	}
	if len(c.entries) > statCacheMax {
		t.Fatalf("%d entries, over the limit of %d", len(c.entries), statCacheMax)
	}
}
