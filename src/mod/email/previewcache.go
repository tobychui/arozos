package email

/*
	previewcache.go

	Message list previews need a partial body fetch per message. A message's
	body never changes (IMAP messages are immutable for a given UIDVALIDITY),
	so previews are cached in memory and refreshing a folder only fetches
	snippets for mail that arrived since.
*/

import (
	"container/list"
	"strconv"
	"strings"
	"sync"

	"imuslab.com/arozos/mod/info/logger"
)

type previewEntry struct {
	key     string
	preview string
}

type previewCache struct {
	mutex    sync.Mutex
	capacity int
	order    *list.List
	entries  map[string]*list.Element
}

func newPreviewCache(capacity int) *previewCache {
	if logger.IsDebugTrace() {
		logger.DebugTracef("email", "newPreviewCache: capacity=%d", capacity)
	}
	return &previewCache{capacity: capacity, order: list.New(), entries: map[string]*list.Element{}}
}

func previewKey(owner string, accountID string, folder string, uidValidity uint32, uid uint32) string {
	if logger.IsDebugTrace() {
		logger.DebugTracef("email", "previewKey: owner=%.120q accountID=%.120q folder=%.120q uidValidity=%d uid=%d", owner, accountID, folder, uidValidity, uid)
	}
	return owner + "/" + accountID + "\x00" + folder + "\x00" + strconv.FormatUint(uint64(uidValidity), 10) + "\x00" + strconv.FormatUint(uint64(uid), 10)
}

func (c *previewCache) get(key string) (string, bool) {
	logger.Debug("email", "previewCache.get")
	c.mutex.Lock()
	defer c.mutex.Unlock()
	if element, ok := c.entries[key]; ok {
		c.order.MoveToFront(element)
		return element.Value.(*previewEntry).preview, true
	}
	return "", false
}

func (c *previewCache) put(key string, preview string) {
	if logger.IsDebug() {
		logger.Debugf("email", "previewCache.put: preview=%.120q", preview)
	}
	c.mutex.Lock()
	defer c.mutex.Unlock()
	if element, ok := c.entries[key]; ok {
		element.Value.(*previewEntry).preview = preview
		c.order.MoveToFront(element)
		return
	}
	c.entries[key] = c.order.PushFront(&previewEntry{key: key, preview: preview})
	for c.order.Len() > c.capacity {
		oldest := c.order.Back()
		c.order.Remove(oldest)
		delete(c.entries, oldest.Value.(*previewEntry).key)
	}
}

// dropAccount forgets every preview of an account.
func (c *previewCache) dropAccount(owner string, accountID string) {
	if logger.IsDebug() {
		logger.Debugf("email", "previewCache.dropAccount: owner=%.120q accountID=%.120q", owner, accountID)
	}
	prefix := owner + "/" + accountID + "\x00"
	c.mutex.Lock()
	defer c.mutex.Unlock()
	for key, element := range c.entries {
		if strings.HasPrefix(key, prefix) {
			c.order.Remove(element)
			delete(c.entries, key)
		}
	}
}
