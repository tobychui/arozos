package sharedspace

/*
	SharedSpace access control

	Spaces carry an access mode (open / public / private) and a member
	list with roles (owner / admin / member):

	  - CanRead: open and public spaces are readable by anyone who can
	    name them; private spaces only by members.
	  - CanPost: same as CanRead - reading a space implies being allowed
	    to contribute to it (the transports decide who may name a space).
	  - CanManage: owner and space admins - membership, metadata, access
	    mode, deletion.

	An empty username is the system authority (internal callers) and
	passes every check. The package never authenticates: transports
	(prouter endpoints, the AGI gateway) hand in validated usernames.
*/

import "sort"

// AccessMode returns the space's current access mode.
func (s *Space) AccessMode() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.access
}

// Role returns the member role of username in the space and whether the
// user is a member at all. The owner always reports RoleOwner.
func (s *Space) Role(username string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	role, ok := s.members[username]
	return role, ok
}

// CanRead reports whether username may read the space's content.
func (s *Space) CanRead(username string) bool {
	if username == "" {
		return true //system authority
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.access != AccessPrivate {
		return true
	}
	_, member := s.members[username]
	return member
}

// CanPost reports whether username may post items / documents into the
// space. Posting rights follow reading rights.
func (s *Space) CanPost(username string) bool {
	return s.CanRead(username)
}

// CanManage reports whether username may administer the space (members,
// metadata, access mode, deletion).
func (s *Space) CanManage(username string) bool {
	if username == "" {
		return true //system authority
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if username == s.Owner {
		return true
	}
	return s.members[username] == RoleAdmin
}

// Members returns a snapshot copy of the member list (username -> role).
func (s *Space) Members() map[string]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	snapshot := make(map[string]string, len(s.members))
	for username, role := range s.members {
		snapshot[username] = role
	}
	return snapshot
}

// MemberCount returns the number of members in the space.
func (s *Space) MemberCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.members)
}

// AddMember invites username into the space with the given role (RoleAdmin
// or RoleMember). Only the owner, a space admin or the system may invite.
func (s *Space) AddMember(requester string, username string, role string) error {
	if role != RoleAdmin && role != RoleMember {
		return ErrInvalidRole
	}
	if !s.CanManage(requester) {
		return ErrPermissionDenied
	}
	if username == "" {
		return ErrInvalidRole
	}

	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return ErrSpaceClosed
	}
	if _, exists := s.members[username]; exists {
		s.mu.Unlock()
		return ErrMemberExists
	}
	if len(s.members) >= maxMembers {
		s.mu.Unlock()
		return ErrSpaceMemberLimit
	}
	s.members[username] = role
	s.mu.Unlock()

	s.mgrPersistSpace()
	s.emitEvent(&SpaceEvent{Kind: EventMemberChanged, Member: username, Role: role, Action: "add"})
	return nil
}

// RemoveMember removes username from the space. Managers may remove anyone
// but the owner; every member may remove themselves (leave).
func (s *Space) RemoveMember(requester string, username string) error {
	if username == s.Owner {
		return ErrPermissionDenied //the owner cannot be removed
	}
	if requester != username && !s.CanManage(requester) {
		return ErrPermissionDenied
	}

	s.mu.Lock()
	if _, exists := s.members[username]; !exists {
		s.mu.Unlock()
		return ErrNotMember
	}
	delete(s.members, username)
	s.mu.Unlock()

	s.mgrPersistSpace()
	s.emitEvent(&SpaceEvent{Kind: EventMemberChanged, Member: username, Action: "remove"})
	return nil
}

// SetMemberRole changes an existing member's role (RoleAdmin or RoleMember).
// The owner's role cannot be changed.
func (s *Space) SetMemberRole(requester string, username string, role string) error {
	if role != RoleAdmin && role != RoleMember {
		return ErrInvalidRole
	}
	if username == s.Owner {
		return ErrPermissionDenied
	}
	if !s.CanManage(requester) {
		return ErrPermissionDenied
	}

	s.mu.Lock()
	if _, exists := s.members[username]; !exists {
		s.mu.Unlock()
		return ErrNotMember
	}
	s.members[username] = role
	s.mu.Unlock()

	s.mgrPersistSpace()
	s.emitEvent(&SpaceEvent{Kind: EventMemberChanged, Member: username, Role: role, Action: "role"})
	return nil
}

// JoinPublic self-joins username into a public or open space as RoleMember.
// Open spaces allow joining so the space shows up in the user's joined
// list; private spaces reject self-joins (invite only).
func (s *Space) JoinPublic(username string) error {
	if username == "" {
		return ErrPermissionDenied
	}

	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return ErrSpaceClosed
	}
	if s.access == AccessPrivate {
		s.mu.Unlock()
		return ErrPermissionDenied
	}
	if _, exists := s.members[username]; exists {
		s.mu.Unlock()
		return ErrMemberExists
	}
	if len(s.members) >= maxMembers {
		s.mu.Unlock()
		return ErrSpaceMemberLimit
	}
	s.members[username] = RoleMember
	s.mu.Unlock()

	s.mgrPersistSpace()
	s.emitEvent(&SpaceEvent{Kind: EventMemberChanged, Member: username, Role: RoleMember, Action: "add"})
	return nil
}

// SetAccess changes the space's access mode. Managers only.
func (s *Space) SetAccess(requester string, access string) error {
	if !validAccessMode(access) {
		return ErrInvalidAccess
	}
	if !s.CanManage(requester) {
		return ErrPermissionDenied
	}

	s.mu.Lock()
	s.access = access
	s.mu.Unlock()

	s.mgrPersistSpace()
	return nil
}

// SetMeta sets (or, with an empty value, deletes) a metadata entry on the
// space. Managers only. Keys and values are length-capped and the total
// number of entries is limited.
func (s *Space) SetMeta(requester string, key string, value string) error {
	if !s.CanManage(requester) {
		return ErrPermissionDenied
	}
	key = clipString(key, maxMetadataKeyLen)
	if key == "" {
		return ErrPermissionDenied
	}
	value = clipString(value, maxMetadataValLen)

	s.mu.Lock()
	if value == "" {
		delete(s.metadata, key)
	} else {
		if _, exists := s.metadata[key]; !exists && len(s.metadata) >= maxMetadataKeys {
			s.mu.Unlock()
			return ErrMetadataLimit
		}
		s.metadata[key] = value
	}
	s.mu.Unlock()

	s.mgrPersistSpace()
	return nil
}

// Metadata returns a snapshot copy of the space's metadata.
func (s *Space) Metadata() map[string]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	snapshot := make(map[string]string, len(s.metadata))
	for key, value := range s.metadata {
		snapshot[key] = value
	}
	return snapshot
}

// sanitizeMetadata validates and clips an initial metadata map.
func sanitizeMetadata(meta map[string]string) map[string]string {
	clean := make(map[string]string)
	if meta == nil {
		return clean
	}
	//Deterministic pick order when the input exceeds the entry cap
	keys := make([]string, 0, len(meta))
	for key := range meta {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if len(clean) >= maxMetadataKeys {
			break
		}
		clippedKey := clipString(key, maxMetadataKeyLen)
		if clippedKey == "" || meta[key] == "" {
			continue
		}
		clean[clippedKey] = clipString(meta[key], maxMetadataValLen)
	}
	return clean
}

// ListPublicSpaces returns a snapshot of every space with AccessPublic.
func (m *Manager) ListPublicSpaces() []*Space {
	m.mu.RLock()
	defer m.mu.RUnlock()
	public := []*Space{}
	for _, space := range m.spaces {
		space.mu.Lock()
		isPublic := space.access == AccessPublic
		space.mu.Unlock()
		if isPublic {
			public = append(public, space)
		}
	}
	return public
}

// ListSpacesByMember returns a snapshot of the spaces username belongs to
// (as owner, admin or member).
func (m *Manager) ListSpacesByMember(username string) []*Space {
	m.mu.RLock()
	defer m.mu.RUnlock()
	joined := []*Space{}
	for _, space := range m.spaces {
		if _, member := space.Role(username); member {
			joined = append(joined, space)
		}
	}
	return joined
}

// ListSpaces returns a snapshot of every live space (administrator surface).
func (m *Manager) ListSpaces() []*Space {
	m.mu.RLock()
	defer m.mu.RUnlock()
	all := make([]*Space, 0, len(m.spaces))
	for _, space := range m.spaces {
		all = append(all, space)
	}
	return all
}

// SpaceDiskUsage returns the approximate bytes a space occupies (item sizes
// plus document contents), computed from in-memory state.
func (m *Manager) SpaceDiskUsage(spaceID string) int64 {
	space, ok := m.GetSpace(spaceID)
	if !ok {
		return 0
	}
	space.mu.Lock()
	defer space.mu.Unlock()
	var total int64
	for _, item := range space.items {
		total += item.Size
	}
	for _, doc := range space.docs {
		total += int64(len(doc.content))
	}
	return total
}
