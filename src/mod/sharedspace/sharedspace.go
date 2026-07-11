package sharedspace

/*
	SharedSpace - Multi-user shared collaboration area
	author: tobychui / AI assisted

	A shared space is a named, in-memory area where multiple different
	users can share text snippets, images and files together. Spaces are
	addressed by a random ID that acts as the access capability: any
	logged-in user who knows the ID can read and post items. Blob items
	(images / files) are stored on local disk until the space is deleted;
	like meeting rooms, spaces never survive a server restart.

	The package is consumer-agnostic: the AGI "sharedspace" library
	exposes it to server-side scripts, and mod/meetroom binds one space
	to every meeting room so in-meeting chat and file sharing land in a
	space that AGI scripts can read from and post into.
*/

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	//ErrSpaceNotFound is returned when the requested space ID does not exist
	ErrSpaceNotFound = errors.New("shared space not found")
	//ErrSpaceClosed is returned when posting into a deleted space
	ErrSpaceClosed = errors.New("shared space closed")
	//ErrSpaceFull is returned when a space reached its item limit
	ErrSpaceFull = errors.New("shared space item limit reached")
	//ErrItemNotFound is returned when the requested item ID does not exist
	ErrItemNotFound = errors.New("item not found")
	//ErrItemTooLarge is returned when an uploaded blob exceeds the size limit
	ErrItemTooLarge = errors.New("item exceeds size limit")
	//ErrInvalidItemType is returned for item types other than text / image / file
	ErrInvalidItemType = errors.New("invalid item type")
	//ErrEmptyText is returned when adding a text item with no content
	ErrEmptyText = errors.New("empty text item")
	//ErrPermissionDenied is returned when the requester may not modify the target
	ErrPermissionDenied = errors.New("permission denied")
)

const (
	//Item types storable in a space
	ItemTypeText  = "text"
	ItemTypeImage = "image"
	ItemTypeFile  = "file"

	spaceIDBytes     = 8         // random bytes per space ID (hex encoded to 16 chars)
	itemIDBytes      = 16        // random bytes per item ID
	maxSpaceName     = 64        // space names are clipped to this many runes
	maxItemName      = 128       // item display names are clipped to this many runes
	maxTextLength    = 4000      // runes per text item
	DefaultMaxUpload = 128 << 20 // 128MB per blob item
	DefaultMaxItems  = 1024      // items per space before posting fails
)

// imageExtensions lists the raster formats treated as inline-displayable
// images. SVG is deliberately excluded: serving user-uploaded SVG inline
// from the ArozOS origin would allow script execution.
var imageExtensions = []string{".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}

// Item is one entry shared into a space: a text snippet or an image / file
// blob stored on disk. Blobs are addressed by a random ID so the original
// file name never becomes part of a filesystem path.
type Item struct {
	ID        string
	Type      string // ItemTypeText, ItemTypeImage or ItemTypeFile
	Name      string // display name of image / file items
	Text      string // content of text items
	Size      int64
	Uploader  string
	Origin    string // free-form tag identifying which subsystem posted the item
	CreatedAt time.Time
	DiskPath  string // blob location on disk, empty for text items
}

// Space is one live shared area.
type Space struct {
	ID         string
	Name       string
	Owner      string
	CreatedAt  time.Time
	storageDir string
	items      []*Item // chronological order
	itemIdx    map[string]*Item
	listeners  map[string]func(*Item)
	maxItems   int
	closed     bool
	mu         sync.Mutex
}

// Manager owns all live spaces and their blob storage.
type Manager struct {
	spaces      map[string]*Space
	storageRoot string
	maxUpload   int64
	mu          sync.RWMutex
}

// NewManager creates a space manager. storageRoot is the directory used for
// blob storage; pass "" to use a folder inside os.TempDir(). maxUpload is the
// per-item blob size limit in bytes; pass 0 for DefaultMaxUpload. Any leftover
// blob files from a previous run are removed.
func NewManager(storageRoot string, maxUpload int64) *Manager {
	if storageRoot == "" {
		storageRoot = filepath.Join(os.TempDir(), "arozos", "sharedspace")
	}
	if maxUpload <= 0 {
		maxUpload = DefaultMaxUpload
	}
	//Spaces are in-memory only: blobs never survive a restart
	os.RemoveAll(storageRoot)
	os.MkdirAll(storageRoot, 0755)
	return &Manager{
		spaces:      make(map[string]*Space),
		storageRoot: storageRoot,
		maxUpload:   maxUpload,
	}
}

// MaxUpload returns the per-item blob size limit of this manager.
func (m *Manager) MaxUpload() int64 {
	return m.maxUpload
}

// randomID returns n random bytes hex encoded.
func randomID(n int) string {
	idBytes := make([]byte, n)
	rand.Read(idBytes)
	return hex.EncodeToString(idBytes)
}

// clipString trims s to at most max runes.
func clipString(s string, max int) string {
	runes := []rune(s)
	if len(runes) > max {
		return string(runes[:max])
	}
	return s
}

// IsImageName reports whether the display name looks like an inline-safe
// raster image, used to classify uploads and to gate inline serving.
func IsImageName(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	for _, imgExt := range imageExtensions {
		if ext == imgExt {
			return true
		}
	}
	return false
}

// CreateSpace creates a new space owned by owner. The generated space ID is
// unique among live spaces.
func (m *Manager) CreateSpace(owner string, name string) *Space {
	m.mu.Lock()
	defer m.mu.Unlock()

	var id string
	for {
		id = randomID(spaceIDBytes)
		if _, exists := m.spaces[id]; !exists {
			break
		}
	}

	name = clipString(name, maxSpaceName)
	if name == "" {
		name = owner + "'s space"
	}

	space := &Space{
		ID:         id,
		Name:       name,
		Owner:      owner,
		CreatedAt:  time.Now(),
		storageDir: filepath.Join(m.storageRoot, id),
		items:      []*Item{},
		itemIdx:    make(map[string]*Item),
		listeners:  make(map[string]func(*Item)),
		maxItems:   DefaultMaxItems,
	}
	m.spaces[id] = space
	return space
}

// GetSpace returns the live space with the given ID.
func (m *Manager) GetSpace(id string) (*Space, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	space, ok := m.spaces[id]
	return space, ok
}

// ListSpacesByOwner returns a snapshot of the spaces owned by owner.
func (m *Manager) ListSpacesByOwner(owner string) []*Space {
	m.mu.RLock()
	defer m.mu.RUnlock()
	owned := []*Space{}
	for _, space := range m.spaces {
		if space.Owner == owner {
			owned = append(owned, space)
		}
	}
	return owned
}

// SpaceCount returns the number of live spaces.
func (m *Manager) SpaceCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.spaces)
}

// DeleteSpace removes a space and its blob files. It reports whether the
// space existed. Safe to call on an unknown ID.
func (m *Manager) DeleteSpace(id string) bool {
	m.mu.Lock()
	space, exists := m.spaces[id]
	if exists {
		delete(m.spaces, id)
	}
	m.mu.Unlock()
	if !exists {
		return false
	}

	space.mu.Lock()
	space.closed = true
	space.items = []*Item{}
	space.itemIdx = make(map[string]*Item)
	space.listeners = make(map[string]func(*Item))
	space.mu.Unlock()

	os.RemoveAll(space.storageDir)
	return true
}

// Subscribe registers a listener invoked (synchronously) for every item
// posted into the space. Re-using a key replaces the previous listener.
func (s *Space) Subscribe(key string, fn func(*Item)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.listeners[key] = fn
}

// Unsubscribe removes a previously registered listener.
func (s *Space) Unsubscribe(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.listeners, key)
}

// notify invokes every listener with the freshly added item. Callers must
// not hold s.mu.
func (s *Space) notify(item *Item) {
	s.mu.Lock()
	fns := make([]func(*Item), 0, len(s.listeners))
	for _, fn := range s.listeners {
		fns = append(fns, fn)
	}
	s.mu.Unlock()
	for _, fn := range fns {
		fn(item)
	}
}

// register appends a fully built item to the space. Callers must not hold
// s.mu. Listeners fire after the item is registered.
func (s *Space) register(item *Item) error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return ErrSpaceClosed
	}
	if len(s.items) >= s.maxItems {
		s.mu.Unlock()
		return ErrSpaceFull
	}
	s.items = append(s.items, item)
	s.itemIdx[item.ID] = item
	s.mu.Unlock()
	s.notify(item)
	return nil
}

// AddText posts a text snippet into the space. origin tags which subsystem
// posted it (e.g. "agi", meetroom.OriginMeetRoom) so consumers can filter
// their own echoes.
func (s *Space) AddText(uploader string, text string, origin string) (*Item, error) {
	if strings.TrimSpace(text) == "" {
		return nil, ErrEmptyText
	}
	text = clipString(text, maxTextLength)
	item := &Item{
		ID:        randomID(itemIDBytes),
		Type:      ItemTypeText,
		Text:      text,
		Size:      int64(len(text)),
		Uploader:  uploader,
		Origin:    origin,
		CreatedAt: time.Now(),
	}
	if err := s.register(item); err != nil {
		return nil, err
	}
	return item, nil
}

// SaveBlob streams src to disk (up to maxSize bytes) and registers it as an
// image / file item. name is display-only and never used as a filesystem
// path. Pass maxSize 0 for DefaultMaxUpload.
func (s *Space) SaveBlob(itemType string, name string, uploader string, origin string, src io.Reader, maxSize int64) (*Item, error) {
	if itemType != ItemTypeImage && itemType != ItemTypeFile {
		return nil, ErrInvalidItemType
	}
	if maxSize <= 0 {
		maxSize = DefaultMaxUpload
	}

	itemID := randomID(itemIDBytes)
	if err := os.MkdirAll(s.storageDir, 0755); err != nil {
		return nil, err
	}
	diskPath := filepath.Join(s.storageDir, itemID)

	dst, err := os.Create(diskPath)
	if err != nil {
		return nil, err
	}
	written, err := io.Copy(dst, io.LimitReader(src, maxSize+1))
	dst.Close()
	if err != nil {
		os.Remove(diskPath)
		return nil, err
	}
	if written > maxSize {
		os.Remove(diskPath)
		return nil, ErrItemTooLarge
	}

	item := &Item{
		ID:        itemID,
		Type:      itemType,
		Name:      clipString(name, maxItemName),
		Size:      written,
		Uploader:  uploader,
		Origin:    origin,
		CreatedAt: time.Now(),
		DiskPath:  diskPath,
	}
	if err := s.register(item); err != nil {
		os.Remove(diskPath)
		return nil, err
	}
	return item, nil
}

// GetItem looks up an item in the space by its ID.
func (s *Space) GetItem(itemID string) (*Item, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.itemIdx[itemID]
	return item, ok
}

// Items returns a chronological snapshot of the current items.
func (s *Space) Items() []*Item {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := make([]*Item, len(s.items))
	copy(list, s.items)
	return list
}

// ItemCount returns the number of items in the space.
func (s *Space) ItemCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.items)
}

// RemoveItem deletes an item (and its blob file) from the space. Only the
// item's uploader, the space owner, or the system (empty requester) may
// remove an item.
func (s *Space) RemoveItem(itemID string, requester string) error {
	s.mu.Lock()
	item, ok := s.itemIdx[itemID]
	if !ok {
		s.mu.Unlock()
		return ErrItemNotFound
	}
	if requester != "" && requester != item.Uploader && requester != s.Owner {
		s.mu.Unlock()
		return ErrPermissionDenied
	}
	delete(s.itemIdx, itemID)
	for i, listed := range s.items {
		if listed.ID == itemID {
			s.items = append(s.items[:i], s.items[i+1:]...)
			break
		}
	}
	s.mu.Unlock()

	if item.DiskPath != "" {
		os.Remove(item.DiskPath)
	}
	return nil
}
