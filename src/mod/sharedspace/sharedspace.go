package sharedspace

/*
	SharedSpace - Multi-user shared collaboration area
	author: tobychui / AI assisted

	A shared space is a named area where multiple different users can
	share text snippets, images, files and collaboratively edited
	documents together. Spaces are the collaboration backbone of ArozOS:
	chat-style apps, document collaboration and even video conferencing
	(MeetRoom) are built on top of them.

	Access control (access.go): a space is "open" (the random space ID
	acts as the access capability - anyone who knows it can read and
	post), "public" (discoverable in a directory, any logged-in user can
	self-join) or "private" (members only, invited by the owner or a
	space admin). Every space carries a member list with owner / admin /
	member roles and a small metadata key-value store.

	Persistence (persistence.go): a space is either ephemeral (in-memory
	only, blobs in temporary storage, gone after a restart - e.g. the
	space bound to a MeetRoom meeting) or persistent (space, items and
	documents write through to the system database and blobs live in a
	durable storage root, surviving restarts - e.g. a Teams/Slack style
	chat room).

	Realtime (channel.go): every space owns a Channel, a WebSocket-ready
	fan-out hub with numbered subscribers, targeted send and broadcast.
	Item / document / membership mutations additionally emit SpaceEvents
	to in-process listeners so transports can push them to clients live.

	Documents (doc.go): revision-numbered collaborative documents with
	compare-and-swap updates and splice patches for realtime co-editing.

	The package is consumer-agnostic: the AGI "sharedspace" library
	exposes it to server-side scripts, the /system/sharedspace/* HTTP and
	WebSocket endpoints expose it to web clients, and mod/meetroom runs
	its meeting signaling over space channels.
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

	"imuslab.com/arozos/mod/database"
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
	//ErrPermissionDenied is returned when the requester may not perform the action
	ErrPermissionDenied = errors.New("permission denied")
	//ErrInvalidAccess is returned for unknown space access modes
	ErrInvalidAccess = errors.New("invalid access mode")
	//ErrInvalidRole is returned for unknown member roles
	ErrInvalidRole = errors.New("invalid member role")
	//ErrNotMember is returned when the target user is not a member of the space
	ErrNotMember = errors.New("not a member of this space")
	//ErrMemberExists is returned when inviting a user who is already a member
	ErrMemberExists = errors.New("already a member")
	//ErrSpaceMemberLimit is returned when a space reached its member limit
	ErrSpaceMemberLimit = errors.New("member limit reached")
	//ErrMetadataLimit is returned when a space reached its metadata entry limit
	ErrMetadataLimit = errors.New("metadata entry limit reached")
	//ErrPersistenceOff is returned when persistent spaces are unavailable or disabled
	ErrPersistenceOff = errors.New("persistence not available")
	//ErrRevisionConflict is returned when a document update carries a stale base revision
	ErrRevisionConflict = errors.New("document revision conflict")
	//ErrDocNotFound is returned when the requested document ID does not exist
	ErrDocNotFound = errors.New("document not found")
	//ErrDocLimitReached is returned when a space reached its document limit
	ErrDocLimitReached = errors.New("document limit reached")
	//ErrDocTooLarge is returned when a document update exceeds the size limit
	ErrDocTooLarge = errors.New("document exceeds size limit")
)

const (
	//Item types storable in a space
	ItemTypeText  = "text"
	ItemTypeImage = "image"
	ItemTypeFile  = "file"

	//Space access modes
	AccessOpen    = "open"    // space ID is the capability; anyone who knows it may read/post
	AccessPublic  = "public"  // listed in the public directory; any logged-in user may self-join
	AccessPrivate = "private" // members only; owner / space admins invite

	//Member roles
	RoleOwner  = "owner"
	RoleAdmin  = "admin"
	RoleMember = "member"

	spaceIDBytes      = 8         // random bytes per space ID (hex encoded to 16 chars)
	itemIDBytes       = 16        // random bytes per item ID
	maxSpaceName      = 64        // space names are clipped to this many runes
	maxItemName       = 128       // item display names are clipped to this many runes
	maxTextLength     = 4000      // runes per text item
	maxMetadataKeys   = 32        // metadata entries per space
	maxMetadataKeyLen = 64        // runes per metadata key
	maxMetadataValLen = 1024      // runes per metadata value
	maxMembers        = 512       // members per space
	DefaultMaxUpload  = 128 << 20 // 128MB per blob item
	DefaultMaxItems   = 1024      // items per space before posting fails / trims
)

// Space event kinds delivered to SubscribeEvents listeners.
const (
	EventItemAdded     = "item-added"
	EventItemRemoved   = "item-removed"
	EventDocCreated    = "doc-created"
	EventDocUpdated    = "doc-updated"
	EventDocDeleted    = "doc-deleted"
	EventMemberChanged = "member-changed"
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
	Seq       int64  // per-space monotonic sequence, restores ordering on reload
	CreatedAt time.Time
	DiskPath  string // blob location on disk, empty for text items
}

// SpaceEvent describes a mutation inside a space, delivered synchronously to
// SubscribeEvents listeners so transports can fan it out to live clients.
type SpaceEvent struct {
	Kind   string       // one of the Event* constants
	Item   *Item        // set for item-* events
	Doc    *DocSnapshot // set for doc-* events
	Patch  *DocPatch    // set for doc-updated events
	Member string       // set for member-changed events
	Role   string       // set for member-changed add / role events
	Action string       // member-changed action: "add", "remove" or "role"
}

// Space is one live shared area.
type Space struct {
	ID         string
	Name       string
	Owner      string
	Persistent bool // write-through to the system database + durable blob storage
	CreatedAt  time.Time

	access      string // AccessOpen, AccessPublic or AccessPrivate; guarded by mu (see AccessMode)
	storageDir  string
	metadata    map[string]string
	members     map[string]string // username -> role; the owner is always present
	docs        map[string]*Doc
	items       []*Item // chronological order
	itemIdx     map[string]*Item
	listeners   map[string]func(*Item)
	evListeners map[string]func(*SpaceEvent)
	channel     *Channel // lazily created realtime hub, stable once created
	nextSeq     int64
	maxItems    int
	trimOldest  bool // drop the oldest item at the cap instead of failing (chat semantics)
	closed      bool
	mgr         *Manager // owning manager, for persistence write-through
	mu          sync.Mutex
}

// Manager owns all live spaces and their blob storage.
type Manager struct {
	spaces          map[string]*Space
	storageRoot     string             // ephemeral blob root, wiped at construction
	persistRoot     string             // durable blob root, never wiped ("" disables persistence)
	db              *database.Database // nil disables persistence
	maxUpload       int64
	defaultMaxItems int
	allowPersistent bool
	mu              sync.RWMutex
}

// ManagerOptions configures NewManagerWithOptions.
type ManagerOptions struct {
	EphemeralRoot   string             // "" -> a folder inside os.TempDir(); wiped at construction
	PersistentRoot  string             // durable blob root, e.g. "system/sharedspace"; "" disables persistence
	MaxUpload       int64              // per-blob size limit; 0 -> DefaultMaxUpload
	DefaultMaxItems int                // per-space item cap; 0 -> DefaultMaxItems
	Database        *database.Database // nil disables persistence
}

// SpaceOptions configures CreateSpaceWithOptions.
type SpaceOptions struct {
	Access     string            // "" -> AccessOpen
	Persistent bool              // survive restarts (requires a persistence-enabled manager)
	Metadata   map[string]string // initial metadata (validated and clipped)
	MaxItems   int               // 0 -> manager default
}

// NewManager creates a memory-only space manager: every space is ephemeral
// and gone after a restart. storageRoot is the directory used for blob
// storage; pass "" to use a folder inside os.TempDir(). maxUpload is the
// per-item blob size limit in bytes; pass 0 for DefaultMaxUpload. Any
// leftover blob files from a previous run are removed.
func NewManager(storageRoot string, maxUpload int64) *Manager {
	return NewManagerWithOptions(ManagerOptions{
		EphemeralRoot: storageRoot,
		MaxUpload:     maxUpload,
	})
}

// NewManagerWithOptions creates a space manager. When both a database and a
// persistent root are supplied, spaces created with SpaceOptions.Persistent
// survive restarts: their records are reloaded from the database and their
// blobs from the persistent root (which is never wiped). The ephemeral root
// is always cleared at construction.
func NewManagerWithOptions(opt ManagerOptions) *Manager {
	ephemeralRoot := opt.EphemeralRoot
	if ephemeralRoot == "" {
		ephemeralRoot = filepath.Join(os.TempDir(), "arozos", "sharedspace")
	}
	maxUpload := opt.MaxUpload
	if maxUpload <= 0 {
		maxUpload = DefaultMaxUpload
	}
	defaultMaxItems := opt.DefaultMaxItems
	if defaultMaxItems <= 0 {
		defaultMaxItems = DefaultMaxItems
	}

	//Ephemeral blobs never survive a restart
	os.RemoveAll(ephemeralRoot)
	os.MkdirAll(ephemeralRoot, 0755)

	m := &Manager{
		spaces:          make(map[string]*Space),
		storageRoot:     ephemeralRoot,
		maxUpload:       maxUpload,
		defaultMaxItems: defaultMaxItems,
	}

	if opt.Database != nil && opt.PersistentRoot != "" {
		m.db = opt.Database
		m.persistRoot = opt.PersistentRoot
		m.allowPersistent = true
		os.MkdirAll(m.persistRoot, 0755)
		m.initPersistenceTables()
		m.loadPersistedSpaces()
	}
	return m
}

// MaxUpload returns the per-item blob size limit of this manager.
func (m *Manager) MaxUpload() int64 {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.maxUpload
}

// SetMaxUpload updates the per-item blob size limit (admin configuration).
func (m *Manager) SetMaxUpload(limit int64) {
	if limit <= 0 {
		limit = DefaultMaxUpload
	}
	m.mu.Lock()
	m.maxUpload = limit
	m.mu.Unlock()
}

// DefaultItemLimit returns the item cap applied to newly created spaces.
func (m *Manager) DefaultItemLimit() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.defaultMaxItems
}

// SetDefaultItemLimit updates the item cap for newly created spaces.
func (m *Manager) SetDefaultItemLimit(limit int) {
	if limit <= 0 {
		limit = DefaultMaxItems
	}
	m.mu.Lock()
	m.defaultMaxItems = limit
	m.mu.Unlock()
}

// PersistenceAvailable reports whether persistent spaces can currently be
// created (persistence wired in and not disabled by an administrator).
func (m *Manager) PersistenceAvailable() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.db != nil && m.persistRoot != "" && m.allowPersistent
}

// SetAllowPersistent enables or disables the creation of new persistent
// spaces (admin configuration). Existing persistent spaces are unaffected.
func (m *Manager) SetAllowPersistent(allow bool) {
	m.mu.Lock()
	m.allowPersistent = allow
	m.mu.Unlock()
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

// validAccessMode reports whether access is a known space access mode.
func validAccessMode(access string) bool {
	return access == AccessOpen || access == AccessPublic || access == AccessPrivate
}

// CreateSpace creates a new open, ephemeral space owned by owner - the
// behaviour every pre-existing consumer (MeetRoom, AGI scripts) relies on.
func (m *Manager) CreateSpace(owner string, name string) *Space {
	space, _ := m.CreateSpaceWithOptions(owner, name, SpaceOptions{})
	return space
}

// CreateSpaceWithOptions creates a new space owned by owner. The generated
// space ID is unique among live spaces. Persistent spaces require a
// persistence-enabled manager (ErrPersistenceOff otherwise).
func (m *Manager) CreateSpaceWithOptions(owner string, name string, opt SpaceOptions) (*Space, error) {
	access := opt.Access
	if access == "" {
		access = AccessOpen
	}
	if !validAccessMode(access) {
		return nil, ErrInvalidAccess
	}

	m.mu.Lock()
	if opt.Persistent && (m.db == nil || m.persistRoot == "" || !m.allowPersistent) {
		m.mu.Unlock()
		return nil, ErrPersistenceOff
	}

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

	maxItems := opt.MaxItems
	if maxItems <= 0 {
		maxItems = m.defaultMaxItems
	}

	space := &Space{
		ID:          id,
		Name:        name,
		Owner:       owner,
		access:      access,
		Persistent:  opt.Persistent,
		CreatedAt:   time.Now(),
		storageDir:  filepath.Join(m.storageRoot, id),
		metadata:    sanitizeMetadata(opt.Metadata),
		members:     map[string]string{owner: RoleOwner},
		docs:        make(map[string]*Doc),
		items:       []*Item{},
		itemIdx:     make(map[string]*Item),
		listeners:   make(map[string]func(*Item)),
		evListeners: make(map[string]func(*SpaceEvent)),
		nextSeq:     1,
		maxItems:    maxItems,
		trimOldest:  opt.Persistent, // persistent chat rooms trim; ephemeral spaces fail at the cap
		mgr:         m,
	}
	if opt.Persistent {
		space.storageDir = filepath.Join(m.persistRoot, id)
	}
	m.spaces[id] = space
	m.mu.Unlock()

	m.persistSpace(space)
	return space, nil
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

// DeleteSpace removes a space, its realtime channel, its blob files and (for
// persistent spaces) its database records. It reports whether the space
// existed. Safe to call on an unknown ID.
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
	space.docs = make(map[string]*Doc)
	space.listeners = make(map[string]func(*Item))
	space.evListeners = make(map[string]func(*SpaceEvent))
	channel := space.channel
	space.mu.Unlock()

	if channel != nil {
		channel.Close()
	}
	os.RemoveAll(space.storageDir)
	if space.Persistent {
		m.deleteSpaceRecords(id)
	}
	return true
}

// Subscribe registers a listener invoked (synchronously) for every item
// posted into the space. Re-using a key replaces the previous listener.
func (s *Space) Subscribe(key string, fn func(*Item)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.listeners[key] = fn
}

// Unsubscribe removes a previously registered item listener.
func (s *Space) Unsubscribe(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.listeners, key)
}

// SubscribeEvents registers a listener invoked (synchronously) for every
// space mutation event. Re-using a key replaces the previous listener.
func (s *Space) SubscribeEvents(key string, fn func(*SpaceEvent)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.evListeners[key] = fn
}

// UnsubscribeEvents removes a previously registered event listener.
func (s *Space) UnsubscribeEvents(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.evListeners, key)
}

// notify invokes every item listener with the freshly added item. Callers
// must not hold s.mu.
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

// emitEvent invokes every event listener with the given event. Callers must
// not hold s.mu.
func (s *Space) emitEvent(event *SpaceEvent) {
	s.mu.Lock()
	fns := make([]func(*SpaceEvent), 0, len(s.evListeners))
	for _, fn := range s.evListeners {
		fns = append(fns, fn)
	}
	s.mu.Unlock()
	for _, fn := range fns {
		fn(event)
	}
}

// register appends a fully built item to the space, trimming the oldest item
// first when a trim-enabled space is at its cap. Callers must not hold s.mu.
// Listeners and events fire after the item is registered.
func (s *Space) register(item *Item) error {
	var victim *Item
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return ErrSpaceClosed
	}
	if len(s.items) >= s.maxItems {
		if !s.trimOldest {
			s.mu.Unlock()
			return ErrSpaceFull
		}
		victim = s.items[0]
		s.items = s.items[1:]
		delete(s.itemIdx, victim.ID)
	}
	item.Seq = s.nextSeq
	s.nextSeq++
	s.items = append(s.items, item)
	s.itemIdx[item.ID] = item
	s.mu.Unlock()

	if victim != nil {
		if victim.DiskPath != "" {
			os.Remove(victim.DiskPath)
		}
		s.mgrDeleteItemRecord(victim.ID)
		s.emitEvent(&SpaceEvent{Kind: EventItemRemoved, Item: victim})
	}
	s.mgrPersistItem(item)
	s.notify(item)
	s.emitEvent(&SpaceEvent{Kind: EventItemAdded, Item: item})
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
// item's uploader, the space owner, a space admin, or the system (empty
// requester) may remove an item.
func (s *Space) RemoveItem(itemID string, requester string) error {
	s.mu.Lock()
	item, ok := s.itemIdx[itemID]
	if !ok {
		s.mu.Unlock()
		return ErrItemNotFound
	}
	if requester != "" && requester != item.Uploader && requester != s.Owner && s.members[requester] != RoleAdmin {
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
	s.mgrDeleteItemRecord(itemID)
	s.emitEvent(&SpaceEvent{Kind: EventItemRemoved, Item: item})
	return nil
}
