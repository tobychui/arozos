package s3fs

import (
	"os"
	"strings"
	"sync"
	"time"
)

/*
	statcache.go

	Every question about a file is a round trip to the bucket, and a client
	asks many: File Explorer looks at the same file ten or more times while
	opening it over SMB, and lists a folder before asking about each file in
	it. The answers are kept here for a few seconds.

	A complete folder listing also answers for names it does not hold, so the
	probes Explorer makes for desktop.ini and the like need no request either.

	Every change made through this drive drops what it could have made wrong.
	Changes made around ArozOS, straight to the bucket, show after at most the
	lifetime of an entry, which matches what the Windows SMB client caches by
	itself. A lookup that started before a change does not keep its answer.
*/

// statCacheTTL is how long an answer is kept.
const statCacheTTL = 10 * time.Second

// statCacheMax bounds the entries kept; past it expired ones are dropped,
// then everything.
const statCacheMax = 50000

type statEntry struct {
	info    os.FileInfo //Nil for a path known to be missing
	expires time.Time
}

type statCache struct {
	mu      sync.Mutex
	ttl     time.Duration
	now     func() time.Time
	gen     uint64               //Counts changes, so a lookup older than one is not kept
	entries map[string]statEntry //By object key without a trailing slash
	listed  map[string]time.Time //Folders whose complete listing is in entries
}

func newStatCache(ttl time.Duration) *statCache {
	return &statCache{
		ttl:     ttl,
		now:     time.Now,
		entries: map[string]statEntry{},
		listed:  map[string]time.Time{},
	}
}

// parentKey returns the folder holding key, "" being the bucket root.
func parentKey(key string) string {
	if i := strings.LastIndexByte(key, '/'); i >= 0 {
		return key[:i]
	}
	return ""
}

// childKey joins a folder key and a name.
func childKey(dir, name string) string {
	if dir == "" {
		return name
	}
	return dir + "/" + name
}

// generation is taken before asking the bucket and handed to put.
func (c *statCache) generation() uint64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.gen
}

// get answers from the cache. known is false when the bucket must be asked;
// otherwise info is nil for a missing path.
func (c *statCache) get(key string) (info os.FileInfo, known bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	if e, ok := c.entries[key]; ok && now.Before(e.expires) {
		return e.info, true
	}
	if key == "" {
		return nil, false
	}
	if until, ok := c.listed[parentKey(key)]; ok && now.Before(until) {
		//The folder was listed whole and nothing changed in it since
		return nil, true
	}
	return nil, false
}

// put keeps an answer, nil info for a missing path, unless something changed
// since gen was taken.
func (c *statCache) put(gen uint64, key string, info os.FileInfo) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if gen != c.gen {
		return
	}
	c.makeRoom(1)
	c.entries[key] = statEntry{info: info, expires: c.now().Add(c.ttl)}
}

// putListing keeps a complete listing of the folder dir, by child name.
func (c *statCache) putListing(gen uint64, dir string, children map[string]os.FileInfo) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if gen != c.gen {
		return
	}
	c.makeRoom(len(children))
	expires := c.now().Add(c.ttl)
	for name, info := range children {
		c.entries[childKey(dir, name)] = statEntry{info: info, expires: expires}
	}
	c.listed[dir] = expires
}

// makeRoom drops expired entries, then all, when n more would not fit.
// The caller holds c.mu.
func (c *statCache) makeRoom(n int) {
	if len(c.entries)+n <= statCacheMax {
		return
	}
	now := c.now()
	for k, e := range c.entries {
		if !now.Before(e.expires) {
			delete(c.entries, k)
		}
	}
	for k, until := range c.listed {
		if !now.Before(until) {
			delete(c.listed, k)
		}
	}
	if len(c.entries)+n > statCacheMax {
		c.entries = map[string]statEntry{}
		c.listed = map[string]time.Time{}
	}
}

// changed drops what a change to one file or empty folder at key can make
// wrong: the path itself and every folder above it, which may have appeared
// or gone with it.
func (c *statCache) changed(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.gen++
	delete(c.entries, key)
	delete(c.listed, key)
	for key != "" {
		key = parentKey(key)
		delete(c.entries, key)
		delete(c.listed, key)
	}
}

// clear drops everything, after a change to a whole folder.
func (c *statCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.gen++
	c.entries = map[string]statEntry{}
	c.listed = map[string]time.Time{}
}
