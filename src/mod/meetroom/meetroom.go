package meetroom

/*
	MeetRoom - Video conferencing room manager
	author: tobychui / AI assisted

	This package implements the server-side room state for the MeetRoom
	video conferencing WebApp: meeting rooms joinable by ID + optional
	password, the participant registry used by the WebSocket signaling
	relay, an attendance log of every join / leave, and temporary
	attachment storage for in-meeting file sharing.

	When a sharedspace.Manager is bound (BindSpaceManager), every room
	created afterwards owns a shared space: chat messages and uploaded
	attachments are mirrored into it (origin OriginMeetRoom) so AGI
	scripts can read the meeting content, and items posted into the
	space from outside the room (e.g. by AGI scripts) are handed to the
	transport layer through SetSpaceItemHandler so they appear in the
	meeting live. The space is deleted together with the room.

	The package is transport-agnostic: the HTTP / WebSocket handlers live
	in the main package (src/meetroom.go) and only push byte slices into
	each participant's send channel. Media itself never touches the
	server - clients exchange WebRTC offers through the signaling relay
	and stream peer-to-peer.
*/

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	mathrand "math/rand"
	"os"
	"path/filepath"
	"sync"
	"time"

	"imuslab.com/arozos/mod/sharedspace"
)

var (
	//ErrRoomNotFound is returned when the requested room ID does not exist
	ErrRoomNotFound = errors.New("room not found")
	//ErrInvalidPassword is returned when the room password does not match
	ErrInvalidPassword = errors.New("invalid room password")
	//ErrRoomClosed is returned when operating on a room that has been closed
	ErrRoomClosed = errors.New("room closed")
	//ErrAttachmentTooLarge is returned when an uploaded attachment exceeds the size limit
	ErrAttachmentTooLarge = errors.New("attachment exceeds size limit")
)

const (
	roomIDLength     = 9         // digits in a meeting room ID, Zoom style
	sendBufferSize   = 256       // per-participant outgoing frame buffer
	maxTitleLength   = 64        // room title is clipped to this many runes
	maxNameLength    = 128       // attachment file names are clipped to this many runes
	maxAttendance    = 1000      // attendance records kept per room (oldest dropped)
	DefaultMaxUpload = 128 << 20 // 128MB per attachment

	//OriginMeetRoom tags shared-space items mirrored from the room itself so
	//the space item bridge can filter its own echoes
	OriginMeetRoom = "meetroom"

	DefaultEmptyIdle = 10 * time.Minute
)

// Participant is one connected member of a room. The transport layer
// (WebSocket handler) drains Send and writes each frame to the socket.
type Participant struct {
	PeerID   int
	Username string
	IsHost   bool
	Send     chan []byte
	joinedAt time.Time
	once     sync.Once
}

// CloseSend closes the participant's send channel exactly once.
func (p *Participant) CloseSend() {
	p.once.Do(func() { close(p.Send) })
}

// Attachment is a file shared into a room, stored on local disk until the
// room is closed. Files are addressed by a random ID so the original file
// name never becomes part of a filesystem path.
type Attachment struct {
	ID       string
	Name     string
	Size     int64
	Uploader string
	DiskPath string
}

// AttendanceRecord is one join / leave entry in a room's attendance log.
// LeftAt is the zero time while the participant is still in the meeting.
type AttendanceRecord struct {
	Username string
	PeerID   int
	JoinedAt time.Time
	LeftAt   time.Time
}

// Present reports whether this record's participant is still in the room.
func (a *AttendanceRecord) Present() bool {
	return a.LeftAt.IsZero()
}

// Room is one live meeting room.
type Room struct {
	ID           string
	Title        string
	Host         string
	SpaceID      string // bound shared space, empty when no space manager is set
	CreatedAt    time.Time
	passwordHash []byte // nil when the room has no password
	participants map[int]*Participant
	attachments  map[string]*Attachment
	attendance   []*AttendanceRecord
	nextPeerID   int
	lastActivity time.Time
	closed       bool
	mu           sync.Mutex
}

// Manager owns all live rooms and their attachment storage.
type Manager struct {
	rooms       map[string]*Room
	storageRoot string
	spaces      *sharedspace.Manager                     // optional shared-space binding
	onSpaceItem func(room *Room, item *sharedspace.Item) // bridge for externally posted space items
	mu          sync.RWMutex
}

// NewManager creates a room manager. storageRoot is the directory used for
// temporary attachment storage; pass "" to use a folder inside os.TempDir().
// Any leftover attachment files from a previous run are removed.
func NewManager(storageRoot string) *Manager {
	if storageRoot == "" {
		storageRoot = filepath.Join(os.TempDir(), "arozos", "meetroom")
	}
	//Attachments never survive a restart: rooms are in-memory only
	os.RemoveAll(storageRoot)
	os.MkdirAll(storageRoot, 0755)
	return &Manager{
		rooms:       make(map[string]*Room),
		storageRoot: storageRoot,
	}
}

// BindSpaceManager links the manager to a shared-space manager. Every room
// created afterwards owns a shared space that mirrors its chat and
// attachments and accepts posts from AGI scripts.
func (m *Manager) BindSpaceManager(sm *sharedspace.Manager) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.spaces = sm
}

// SetSpaceItemHandler sets the callback invoked when an item lands in a
// room's shared space from outside the room itself (anything whose origin is
// not OriginMeetRoom, e.g. an AGI script). The transport layer uses it to
// push the item into the meeting as a live chat / file message.
func (m *Manager) SetSpaceItemHandler(fn func(room *Room, item *sharedspace.Item)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.onSpaceItem = fn
}

// spaceOf returns the shared space bound to the room, if any.
func (m *Manager) spaceOf(room *Room) (*sharedspace.Space, bool) {
	m.mu.RLock()
	sm := m.spaces
	m.mu.RUnlock()
	if sm == nil || room.SpaceID == "" {
		return nil, false
	}
	return sm.GetSpace(room.SpaceID)
}

// hashRoomPassword derives the stored hash for a room password. The room ID
// acts as the salt so identical passwords in different rooms hash differently.
func hashRoomPassword(roomID string, password string) []byte {
	sum := sha256.Sum256([]byte(roomID + ":" + password))
	return sum[:]
}

// clipString trims s to at most max runes.
func clipString(s string, max int) string {
	runes := []rune(s)
	if len(runes) > max {
		return string(runes[:max])
	}
	return s
}

// CreateRoom creates a new room hosted by host. password may be empty for an
// open room. The generated room ID is unique among live rooms.
func (m *Manager) CreateRoom(host string, title string, password string) *Room {
	m.mu.Lock()
	defer m.mu.Unlock()

	var id string
	for {
		id = randomDigits(roomIDLength)
		if _, exists := m.rooms[id]; !exists {
			break
		}
	}

	title = clipString(title, maxTitleLength)
	if title == "" {
		title = host + "'s Meeting"
	}

	room := &Room{
		ID:           id,
		Title:        title,
		Host:         host,
		CreatedAt:    time.Now(),
		participants: make(map[int]*Participant),
		attachments:  make(map[string]*Attachment),
		attendance:   []*AttendanceRecord{},
		nextPeerID:   1,
		lastActivity: time.Now(),
	}
	if password != "" {
		room.passwordHash = hashRoomPassword(id, password)
	}

	//Bind a shared space to the room: chat / attachments mirror into it and
	//externally posted items (AGI) flow back through the item bridge.
	if m.spaces != nil {
		space := m.spaces.CreateSpace(host, title)
		room.SpaceID = space.ID
		space.Subscribe(OriginMeetRoom, func(item *sharedspace.Item) {
			if item.Origin == OriginMeetRoom {
				return //the room's own echo, already delivered over WebSocket
			}
			m.mu.RLock()
			handler := m.onSpaceItem
			m.mu.RUnlock()
			if handler != nil {
				handler(room, item)
			}
		})
	}

	m.rooms[id] = room
	return room
}

// randomDigits returns n random decimal digits with no leading zero.
func randomDigits(n int) string {
	digits := make([]byte, n)
	digits[0] = byte('1' + mathrand.Intn(9))
	for i := 1; i < n; i++ {
		digits[i] = byte('0' + mathrand.Intn(10))
	}
	return string(digits)
}

// GetRoom returns the live room with the given ID.
func (m *Manager) GetRoom(id string) (*Room, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	room, ok := m.rooms[id]
	return room, ok
}

// ValidateJoin checks that the room exists and that the supplied password is
// correct, returning the room on success.
func (m *Manager) ValidateJoin(id string, password string) (*Room, error) {
	room, ok := m.GetRoom(id)
	if !ok {
		return nil, ErrRoomNotFound
	}
	if !room.CheckPassword(password) {
		return nil, ErrInvalidPassword
	}
	return room, nil
}

// HasPassword reports whether the room requires a password to join.
func (r *Room) HasPassword() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.passwordHash != nil
}

// CheckPassword reports whether the supplied password unlocks the room.
func (r *Room) CheckPassword(password string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.passwordHash == nil {
		return true
	}
	candidate := hashRoomPassword(r.ID, password)
	return subtle.ConstantTimeCompare(r.passwordHash, candidate) == 1
}

// AddParticipant registers a new participant and returns it. The transport
// layer must drain the returned participant's Send channel.
func (r *Room) AddParticipant(username string) (*Participant, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil, ErrRoomClosed
	}
	p := &Participant{
		PeerID:   r.nextPeerID,
		Username: username,
		IsHost:   username == r.Host,
		Send:     make(chan []byte, sendBufferSize),
		joinedAt: time.Now(),
	}
	r.nextPeerID++
	r.participants[p.PeerID] = p
	r.attendance = append(r.attendance, &AttendanceRecord{
		Username: username,
		PeerID:   p.PeerID,
		JoinedAt: p.joinedAt,
	})
	if len(r.attendance) > maxAttendance {
		r.attendance = r.attendance[len(r.attendance)-maxAttendance:]
	}
	r.lastActivity = time.Now()
	return p, nil
}

// RemoveParticipant unregisters a participant and closes its send channel.
func (r *Room) RemoveParticipant(peerID int) {
	r.mu.Lock()
	p, ok := r.participants[peerID]
	if ok {
		delete(r.participants, peerID)
	}
	for _, record := range r.attendance {
		if record.PeerID == peerID && record.Present() {
			record.LeftAt = time.Now()
			break
		}
	}
	r.lastActivity = time.Now()
	r.mu.Unlock()
	if ok {
		p.CloseSend()
	}
}

// Attendance returns a snapshot of the room's join / leave log in
// chronological join order.
func (r *Room) Attendance() []AttendanceRecord {
	r.mu.Lock()
	defer r.mu.Unlock()
	list := make([]AttendanceRecord, 0, len(r.attendance))
	for _, record := range r.attendance {
		list = append(list, *record)
	}
	return list
}

// HasParticipantUsername reports whether a user with the given username is
// currently connected to the room.
func (r *Room) HasParticipantUsername(username string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, p := range r.participants {
		if p.Username == username {
			return true
		}
	}
	return false
}

// Participants returns a snapshot of the current participants.
func (r *Room) Participants() []*Participant {
	r.mu.Lock()
	defer r.mu.Unlock()
	list := make([]*Participant, 0, len(r.participants))
	for _, p := range r.participants {
		list = append(list, p)
	}
	return list
}

// ParticipantCount returns the number of connected participants.
func (r *Room) ParticipantCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.participants)
}

// GetParticipant returns the participant with the given peer ID.
func (r *Room) GetParticipant(peerID int) (*Participant, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	p, ok := r.participants[peerID]
	return p, ok
}

// Broadcast queues msg to every participant except excludePeerID (pass a
// negative value to send to everyone). Full send buffers drop the frame
// rather than blocking the room.
func (r *Room) Broadcast(msg []byte, excludePeerID int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, p := range r.participants {
		if id == excludePeerID {
			continue
		}
		select {
		case p.Send <- append([]byte(nil), msg...):
		default:
		}
	}
}

// SendTo queues msg to a single participant. It reports whether the peer
// exists in the room.
func (r *Room) SendTo(peerID int, msg []byte) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	p, ok := r.participants[peerID]
	if !ok {
		return false
	}
	select {
	case p.Send <- append([]byte(nil), msg...):
	default:
	}
	return true
}

// Touch refreshes the room's idle timer.
func (r *Room) Touch() {
	r.mu.Lock()
	r.lastActivity = time.Now()
	r.mu.Unlock()
}

// SaveAttachment streams src to disk (up to maxSize bytes) and registers the
// file in the room under a random ID. name is display-only and never used as
// a filesystem path. Rooms with a bound shared space store the file in the
// space instead, so AGI scripts can access it too.
func (m *Manager) SaveAttachment(roomID string, name string, uploader string, src io.Reader, maxSize int64) (*Attachment, error) {
	room, ok := m.GetRoom(roomID)
	if !ok {
		return nil, ErrRoomNotFound
	}
	if maxSize <= 0 {
		maxSize = DefaultMaxUpload
	}

	//Space-backed room: the shared space owns the blob storage
	if space, ok := m.spaceOf(room); ok {
		itemType := sharedspace.ItemTypeFile
		if sharedspace.IsImageName(name) {
			itemType = sharedspace.ItemTypeImage
		}
		item, err := space.SaveBlob(itemType, name, uploader, OriginMeetRoom, src, maxSize)
		if err != nil {
			if err == sharedspace.ErrItemTooLarge {
				return nil, ErrAttachmentTooLarge
			}
			if err == sharedspace.ErrSpaceClosed {
				return nil, ErrRoomClosed
			}
			return nil, err
		}
		room.Touch()
		return &Attachment{
			ID:       item.ID,
			Name:     item.Name,
			Size:     item.Size,
			Uploader: item.Uploader,
			DiskPath: item.DiskPath,
		}, nil
	}

	idBytes := make([]byte, 16)
	if _, err := rand.Read(idBytes); err != nil {
		return nil, err
	}
	fileID := hex.EncodeToString(idBytes)

	roomDir := filepath.Join(m.storageRoot, roomID)
	if err := os.MkdirAll(roomDir, 0755); err != nil {
		return nil, err
	}
	diskPath := filepath.Join(roomDir, fileID)

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
		return nil, ErrAttachmentTooLarge
	}

	attachment := &Attachment{
		ID:       fileID,
		Name:     clipString(name, maxNameLength),
		Size:     written,
		Uploader: uploader,
		DiskPath: diskPath,
	}

	room.mu.Lock()
	if room.closed {
		room.mu.Unlock()
		os.Remove(diskPath)
		return nil, ErrRoomClosed
	}
	room.attachments[fileID] = attachment
	room.lastActivity = time.Now()
	room.mu.Unlock()
	return attachment, nil
}

// GetAttachment looks up a shared file in a room by its ID, consulting the
// bound shared space when the room has one (covering both room uploads and
// files posted into the space by AGI scripts).
func (m *Manager) GetAttachment(roomID string, fileID string) (*Attachment, bool) {
	room, ok := m.GetRoom(roomID)
	if !ok {
		return nil, false
	}
	room.mu.Lock()
	attachment, ok := room.attachments[fileID]
	room.mu.Unlock()
	if ok {
		return attachment, true
	}
	if space, hasSpace := m.spaceOf(room); hasSpace {
		if item, found := space.GetItem(fileID); found && item.DiskPath != "" {
			return &Attachment{
				ID:       item.ID,
				Name:     item.Name,
				Size:     item.Size,
				Uploader: item.Uploader,
				DiskPath: item.DiskPath,
			}, true
		}
	}
	return nil, false
}

// LogChat mirrors a chat message into the room's bound shared space so AGI
// scripts can read the meeting conversation. No-op for rooms without a space.
func (m *Manager) LogChat(roomID string, username string, text string) {
	room, ok := m.GetRoom(roomID)
	if !ok {
		return
	}
	if space, hasSpace := m.spaceOf(room); hasSpace {
		space.AddText(username, text, OriginMeetRoom)
	}
}

// ListRoomsByHost returns a snapshot of the live rooms hosted by host.
func (m *Manager) ListRoomsByHost(host string) []*Room {
	m.mu.RLock()
	defer m.mu.RUnlock()
	hosted := []*Room{}
	for _, room := range m.rooms {
		if room.Host == host {
			hosted = append(hosted, room)
		}
	}
	return hosted
}

// CloseRoom removes the room, closes every participant's send channel and
// deletes the room's attachment files. Safe to call on an unknown ID.
// It returns the removed room's participants so the transport layer can
// finish delivering any queued frames before the sockets drop.
func (m *Manager) CloseRoom(id string) []*Participant {
	m.mu.Lock()
	room, exists := m.rooms[id]
	if exists {
		delete(m.rooms, id)
	}
	m.mu.Unlock()
	if !exists {
		return nil
	}

	room.mu.Lock()
	room.closed = true
	members := make([]*Participant, 0, len(room.participants))
	for _, p := range room.participants {
		members = append(members, p)
	}
	room.participants = make(map[int]*Participant)
	room.attachments = make(map[string]*Attachment)
	room.mu.Unlock()

	for _, p := range members {
		p.CloseSend()
	}
	os.RemoveAll(filepath.Join(m.storageRoot, id))

	//The bound shared space lives and dies with the room
	m.mu.RLock()
	sm := m.spaces
	m.mu.RUnlock()
	if sm != nil && room.SpaceID != "" {
		sm.DeleteSpace(room.SpaceID)
	}
	return members
}

// SweepIdleRooms closes every room that has no participants and has been
// idle for longer than emptyIdle, returning the IDs it closed.
func (m *Manager) SweepIdleRooms(emptyIdle time.Duration) []string {
	if emptyIdle <= 0 {
		emptyIdle = DefaultEmptyIdle
	}
	var toClose []string
	m.mu.RLock()
	for id, room := range m.rooms {
		room.mu.Lock()
		if len(room.participants) == 0 && time.Since(room.lastActivity) > emptyIdle {
			toClose = append(toClose, id)
		}
		room.mu.Unlock()
	}
	m.mu.RUnlock()

	for _, id := range toClose {
		m.CloseRoom(id)
	}
	return toClose
}

// RoomCount returns the number of live rooms.
func (m *Manager) RoomCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.rooms)
}

// FormatRoomID renders a room ID in the display form xxx-xxx-xxx.
func FormatRoomID(id string) string {
	if len(id) != roomIDLength {
		return id
	}
	return fmt.Sprintf("%s-%s-%s", id[0:3], id[3:6], id[6:9])
}

// NormalizeRoomID strips the separators FormatRoomID (or a user) may have
// added, accepting inputs like "123-456-789" or "123 456 789".
func NormalizeRoomID(id string) string {
	out := make([]rune, 0, len(id))
	for _, c := range id {
		if c >= '0' && c <= '9' {
			out = append(out, c)
		}
	}
	return string(out)
}
