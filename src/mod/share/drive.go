package share

/*
	Shared with me

	Builds the root of the share:/ drive (mod/filesystem/abstractions/sharefs):
	the files and folders other users shared with someone, each under a name
	that is unique on that drive, so the File Manager can browse them like a
	folder instead of opening each share link on its own page.

	Only shares that name the user as a recipient count: an invited user, one
	of the user's groups, or a same group share whose groups the user is in.
	"Anyone with the link" and "signed-in users with the link" shares are left
	out. Their audience is whoever was handed the link, so listing them on
	every account would publish links their owners only meant to pass around.
	Password protected shares are left out too: the drive cannot ask for the
	password, and handing the files over without it would defeat the point.
	All of these still open from their link as before.
*/

import (
	"net/http"
	"path"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	filesystem "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/sharefs"
	"imuslab.com/arozos/mod/share/shareEntry"
	"imuslab.com/arozos/mod/utils"
)

// SharedDriveUUID is the virtual root id of the drive, "share:/"
const SharedDriveUUID = "share"

// How long a user's drive root is reused before it is built again. Every
// file operation on the drive resolves its path against the root, so this
// keeps a folder listing from rebuilding it once per file.
const sharedDriveCacheTTL = 2 * time.Second

// sharedEntry is one item of a user's drive root before it is tied to the
// drive the file lives on
type sharedEntry struct {
	Name   string
	Shares []*shareEntry.ShareOption //Shares of the same file, oldest first
}

func (e *sharedEntry) first() *shareEntry.ShareOption {
	return e.Shares[0]
}

// permissions merges what the shares of one file allow: the user could use
// any of their links, so the most generous of them applies.
func (e *sharedEntry) permissions() (canBrowse bool, canDownload bool, canUpload bool) {
	for _, so := range e.Shares {
		canBrowse = canBrowse || (so.IsFolder && so.ShowFileList)
		canDownload = canDownload || so.AllowDownload
		canUpload = canUpload || so.CanUpload()
	}
	return
}

// isAddressedTo reports whether a share names the user as a recipient, see
// the note at the top of this file
func isAddressedTo(so *shareEntry.ShareOption, username string, groups []string) bool {
	if so.Owner == username {
		return false
	}
	switch so.Permission {
	case shareEntry.PermissionUsers:
		return utils.StringInArray(so.Accessibles, username)
	case shareEntry.PermissionGroups:
		for _, group := range groups {
			if utils.StringInArray(so.Accessibles, group) {
				return true
			}
		}
	case shareEntry.PermissionSameGroup:
		//The same rule the share link applies: every group the owner was in
		//when sharing. A share that recorded no groups is not addressed to
		//anybody in particular.
		if len(so.Accessibles) == 0 {
			return false
		}
		for _, group := range so.Accessibles {
			if !utils.StringInArray(groups, group) {
				return false
			}
		}
		return true
	}
	return false
}

// itemBaseName is the name a shared file or folder would like to have on the
// drive: its own name, or for a whole shared drive the drive's id
func itemBaseName(so *shareEntry.ShareOption) string {
	vrootID, subpath, err := filesystem.GetIDFromVirtualPath(so.FileVirtualPath)
	if err != nil {
		return so.UUID
	}
	name := path.Base(path.Clean("/" + strings.ReplaceAll(subpath, "\\", "/")))
	if name == "/" || name == "." || name == "" {
		return vrootID
	}
	return name
}

// nameWithSuffix puts a suffix after a name, before the extension of a file:
// "report.pdf" -> "report (bob).pdf", "Photos" -> "Photos (bob)"
func nameWithSuffix(name string, suffix string, isDir bool) string {
	ext := ""
	if !isDir {
		ext = path.Ext(name)
		if ext == name {
			//A dot file such as ".bashrc" has no extension to keep
			ext = ""
		}
	}
	return strings.TrimSuffix(name, ext) + " (" + suffix + ")" + ext
}

/*
sharedWith lists what is shared with a user as the entries of the drive root.

Shares of the same file are merged into one entry. Every entry gets a name
unique on the drive, compared without case so two entries never differ only
in case: the file's own name for the oldest share of that name, then the
owner's name added for the next, then a counter. Names only depend on the
shares, never on whether the file is reachable right now, so a drive that is
offline for a moment does not rename everything after it.
*/
func sharedWith(all []*shareEntry.ShareOption, username string, groups []string, now time.Time) []*sharedEntry {
	addressed := []*shareEntry.ShareOption{}
	for _, so := range all {
		if so.IsExpired(now) || so.HasPassword() || !isAddressedTo(so, username, groups) {
			continue
		}
		addressed = append(addressed, so)
	}
	sort.SliceStable(addressed, func(i, j int) bool {
		if addressed[i].CreatedAt != addressed[j].CreatedAt {
			return addressed[i].CreatedAt < addressed[j].CreatedAt
		}
		return addressed[i].UUID < addressed[j].UUID
	})

	entries := []*sharedEntry{}
	byPath := map[string]*sharedEntry{}
	for _, so := range addressed {
		if entry, ok := byPath[so.PathHash]; ok {
			entry.Shares = append(entry.Shares, so)
			continue
		}
		entry := &sharedEntry{Shares: []*shareEntry.ShareOption{so}}
		byPath[so.PathHash] = entry
		entries = append(entries, entry)
	}

	taken := map[string]bool{}
	for _, entry := range entries {
		so := entry.first()
		base := itemBaseName(so)
		name := base
		for n := 1; taken[strings.ToLower(name)]; n++ {
			suffix := so.Owner
			if n > 1 {
				suffix += " " + strconv.Itoa(n)
			}
			name = nameWithSuffix(base, suffix, so.IsFolder)
		}
		taken[strings.ToLower(name)] = true
		entry.Name = name
	}
	return entries
}

/*
	Drive root, as the sharefs.Resolver of the share:/ drive
*/

type sharedDriveCacheEntry struct {
	items   []*sharefs.Item
	builtAt time.Time
}

type sharedDriveCache struct {
	mu    sync.Mutex
	users map[string]sharedDriveCacheEntry
}

func (c *sharedDriveCache) get(username string, now time.Time) ([]*sharefs.Item, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.users[username]
	if !ok || now.Sub(entry.builtAt) > sharedDriveCacheTTL {
		return nil, false
	}
	return entry.items, true
}

func (c *sharedDriveCache) put(username string, items []*sharefs.Item, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.users == nil {
		c.users = map[string]sharedDriveCacheEntry{}
	}
	c.users[username] = sharedDriveCacheEntry{items: items, builtAt: now}
}

// clear drops every user's root, after a share was created, changed or removed
func (c *sharedDriveCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.users = nil
}

// Items lists what is shared with a user, for the share:/ drive
func (s *Manager) Items(username string) []*sharefs.Item {
	now := time.Now()
	if items, ok := s.driveCache.get(username, now); ok {
		return items
	}
	items := s.buildSharedDriveItems(username, now)
	s.driveCache.put(username, items, now)
	return items
}

// buildSharedDriveItems ties each entry shared with the user to the drive
// its file lives on. An entry whose owner or drive cannot be resolved right
// now is left out; its name stays reserved, see sharedWith.
func (s *Manager) buildSharedDriveItems(username string, now time.Time) []*sharefs.Item {
	items := []*sharefs.Item{}
	if s.options.UserHandler == nil || s.options.ShareEntryTable == nil {
		return items
	}
	if !s.options.UserHandler.GetAuthAgent().UserExists(username) {
		return items
	}

	groups := []string{}
	if pgs, err := s.options.UserHandler.GetPermissionHandler().GetUsersPermissionGroup(username); err == nil {
		for _, pg := range pgs {
			groups = append(groups, pg.Name)
		}
	}

	for _, entry := range sharedWith(s.options.ShareEntryTable.ListAllShares(), username, groups, now) {
		so := entry.first()
		owner, err := s.options.UserHandler.GetUserInfoFromUsername(so.Owner)
		if err != nil {
			continue
		}
		fsh, err := owner.GetFileSystemHandlerFromVirtualPath(so.FileVirtualPath)
		if err != nil || fsh == nil || fsh.FileSystemAbstraction == nil || fsh.Closed || IsSharedDrive(fsh) {
			continue
		}
		root, err := fsh.FileSystemAbstraction.VirtualPathToRealPath(so.FileVirtualPath, owner.Username)
		if err != nil {
			continue
		}

		shareIDs := []string{}
		for _, share := range entry.Shares {
			shareIDs = append(shareIDs, share.UUID)
		}
		canBrowse, canDownload, canUpload := entry.permissions()
		items = append(items, &sharefs.Item{
			Name:        entry.Name,
			Owner:       so.Owner,
			ShareIDs:    shareIDs,
			IsDir:       so.IsFolder,
			CanBrowse:   canBrowse,
			CanDownload: canDownload,
			CanUpload:   canUpload,
			Fsh:         fsh,
			Root:        root,
		})
	}
	return items
}

// IsSharedDrive reports whether a file system handler is the share:/ drive
func IsSharedDrive(fsh *filesystem.FileSystemHandler) bool {
	if fsh == nil {
		return false
	}
	_, ok := fsh.FileSystemAbstraction.(*sharefs.ShareFileSystem)
	return ok
}

/*
	API
*/

// SharedItemInfo is the client facing view of an item on the share:/ drive.
// It says what the item allows, never where the file really lives.
type SharedItemInfo struct {
	Name        string //Name at the drive root
	Path        string //Its virtual path, share:/<Name>
	Owner       string
	IsFolder    bool
	CanBrowse   bool
	CanDownload bool
	CanUpload   bool
	ShareUUID   string //The oldest share granting access, for its link page
}

// HandleListSharedWithMe lists the root of the user's share:/ drive with
// what each item allows, which the File Manager uses to offer only the file
// operations that can work on it.
func (s *Manager) HandleListSharedWithMe(w http.ResponseWriter, r *http.Request) {
	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	results := []*SharedItemInfo{}
	for _, item := range s.Items(userinfo.Username) {
		shareUUID := ""
		if len(item.ShareIDs) > 0 {
			shareUUID = item.ShareIDs[0]
		}
		results = append(results, &SharedItemInfo{
			Name:        item.Name,
			Path:        SharedDriveUUID + ":/" + item.Name,
			Owner:       item.Owner,
			IsFolder:    item.IsDir,
			CanBrowse:   item.CanBrowse,
			CanDownload: item.CanDownload,
			CanUpload:   item.CanUpload,
			ShareUUID:   shareUUID,
		})
	}
	sendJSON(w, results)
}
