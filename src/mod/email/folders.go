package email

/*
	folders.go

	Mailbox listing, role detection and folder management.

	Roles come from SPECIAL-USE attributes when the server provides them
	(Gmail, Outlook, iCloud, Dovecot) and from well-known names otherwise.
	Folder lists are cached briefly per account because every delete, archive
	or junk action needs to know where the Trash / Archive / Junk folder is.
*/

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
)

const folderCacheTTL = 10 * time.Minute

type folderCacheEntry struct {
	folders []Folder
	loaded  time.Time
}

// folderCache remembers each account's folder list for a few minutes.
type folderCache struct {
	mutex   sync.Mutex
	entries map[string]folderCacheEntry
}

// specialUseRoles maps lower-cased SPECIAL-USE attributes (attributes are
// case-insensitive on the wire) to roles.
var specialUseRoles = map[string]string{
	strings.ToLower(string(imap.MailboxAttrSent)):      RoleSent,
	strings.ToLower(string(imap.MailboxAttrDrafts)):    RoleDrafts,
	strings.ToLower(string(imap.MailboxAttrTrash)):     RoleTrash,
	strings.ToLower(string(imap.MailboxAttrJunk)):      RoleJunk,
	strings.ToLower(string(imap.MailboxAttrArchive)):   RoleArchive,
	strings.ToLower(string(imap.MailboxAttrAll)):       RoleAll,
	strings.ToLower(string(imap.MailboxAttrFlagged)):   RoleFlagged,
	strings.ToLower(string(imap.MailboxAttrImportant)): RoleImportant,
}

// Folder names used by servers without SPECIAL-USE, keyed by lower case.
var wellKnownFolderNames = map[string]string{
	"sent": RoleSent, "sent items": RoleSent, "sent messages": RoleSent, "sent mail": RoleSent,
	"sent-mail": RoleSent, "outbox sent": RoleSent, "已发送": RoleSent, "已傳送": RoleSent,
	"已發送": RoleSent, "送信済み": RoleSent, "gesendet": RoleSent, "envoyés": RoleSent,
	"drafts": RoleDrafts, "draft": RoleDrafts, "草稿": RoleDrafts, "草稿箱": RoleDrafts,
	"下書き": RoleDrafts, "entwürfe": RoleDrafts, "brouillons": RoleDrafts,
	"trash": RoleTrash, "deleted items": RoleTrash, "deleted messages": RoleTrash,
	"deleted": RoleTrash, "bin": RoleTrash, "已删除": RoleTrash, "已刪除": RoleTrash,
	"ゴミ箱": RoleTrash, "papierkorb": RoleTrash, "corbeille": RoleTrash,
	"junk": RoleJunk, "junk email": RoleJunk, "junk e-mail": RoleJunk, "spam": RoleJunk,
	"bulk mail": RoleJunk, "bulk": RoleJunk, "垃圾邮件": RoleJunk, "垃圾郵件": RoleJunk,
	"迷惑メール":   RoleJunk,
	"archive": RoleArchive, "archives": RoleArchive, "归档": RoleArchive, "封存": RoleArchive,
	"all mail": RoleAll,
}

var roleOrder = map[string]int{
	RoleInbox: 0, RoleFlagged: 1, RoleDrafts: 2, RoleSent: 3, RoleArchive: 4,
	RoleAll: 5, RoleImportant: 6, RoleJunk: 7, RoleTrash: 8,
}

// Folders lists the mailboxes of an account with message counts.
func (m *Manager) Folders(ctx context.Context, p Principal, accountID string, refresh bool) ([]Folder, error) {
	account, err := m.account(p, accountID)
	if err != nil {
		return nil, err
	}
	key := poolKey(p.Username, account.ID)
	if !refresh {
		if cached, ok := m.cachedFolders(key); ok {
			return cached, nil
		}
	}

	var folders []Folder
	err = m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		var err error
		folders, err = listFolders(c, true)
		return err
	})
	if err != nil {
		return nil, err
	}
	m.clearAuthError(p, account)
	m.storeFolders(key, folders)
	return folders, nil
}

// foldersQuick returns the cached folder list or lists without counts, for
// operations that only need to find a role folder.
func (m *Manager) foldersQuick(c *imapclient.Client, key string) ([]Folder, error) {
	if cached, ok := m.cachedFolders(key); ok {
		return cached, nil
	}
	folders, err := listFolders(c, false)
	if err != nil {
		return nil, err
	}
	m.storeFolders(key, folders)
	return folders, nil
}

func (m *Manager) cachedFolders(key string) ([]Folder, bool) {
	m.folders.mutex.Lock()
	defer m.folders.mutex.Unlock()
	entry, ok := m.folders.entries[key]
	if !ok || time.Since(entry.loaded) > folderCacheTTL {
		return nil, false
	}
	return entry.folders, true
}

func (m *Manager) storeFolders(key string, folders []Folder) {
	m.folders.mutex.Lock()
	defer m.folders.mutex.Unlock()
	if m.folders.entries == nil {
		m.folders.entries = map[string]folderCacheEntry{}
	}
	m.folders.entries[key] = folderCacheEntry{folders: folders, loaded: time.Now()}
}

func (m *Manager) dropFolderCache(key string) {
	m.folders.mutex.Lock()
	defer m.folders.mutex.Unlock()
	delete(m.folders.entries, key)
}

// listFolders runs LIST (and STATUS where needed) on a connection.
func listFolders(c *imapclient.Client, withCounts bool) ([]Folder, error) {
	caps := c.Caps()
	options := &imap.ListOptions{}
	if caps.Has(imap.CapSpecialUse) && (caps.Has(imap.CapListExtended) || caps.Has(imap.CapIMAP4rev2)) {
		options.ReturnSpecialUse = true
	}
	listStatus := withCounts && (caps.Has(imap.CapListStatus) || caps.Has(imap.CapIMAP4rev2))
	if listStatus {
		options.ReturnStatus = &imap.StatusOptions{NumMessages: true, NumUnseen: true}
	}

	mailboxes, err := c.List("", "*", options).Collect()
	if err != nil && options.ReturnStatus != nil {
		//Some servers advertise LIST-STATUS but choke on it; retry plainly
		options.ReturnStatus = nil
		listStatus = false
		mailboxes, err = c.List("", "*", options).Collect()
	}
	if err != nil {
		return nil, err
	}

	folders := make([]Folder, 0, len(mailboxes))
	for _, mailbox := range mailboxes {
		folder := Folder{
			Name:       mailbox.Mailbox,
			Selectable: true,
			Total:      -1,
			Unread:     -1,
		}
		if mailbox.Delim != 0 {
			folder.Delimiter = string(mailbox.Delim)
		}
		for _, attr := range mailbox.Attrs {
			lower := strings.ToLower(string(attr))
			if lower == strings.ToLower(string(imap.MailboxAttrNoSelect)) || lower == strings.ToLower(string(imap.MailboxAttrNonExistent)) {
				folder.Selectable = false
			}
			if role, ok := specialUseRoles[lower]; ok && folder.Role == "" {
				folder.Role = role
			}
		}
		if strings.EqualFold(folder.Name, "INBOX") {
			folder.Role = RoleInbox
		}
		if mailbox.Status != nil {
			if mailbox.Status.NumMessages != nil {
				folder.Total = int(*mailbox.Status.NumMessages)
			}
			if mailbox.Status.NumUnseen != nil {
				folder.Unread = int(*mailbox.Status.NumUnseen)
			}
		}

		segments := []string{folder.Name}
		if folder.Delimiter != "" {
			segments = strings.Split(folder.Name, folder.Delimiter)
		}
		folder.Display = segments[len(segments)-1]
		folder.Depth = len(segments) - 1
		if len(segments) > 1 {
			folder.Parent = strings.Join(segments[:len(segments)-1], folder.Delimiter)
		}
		if folder.Role == RoleInbox {
			folder.Display = "Inbox"
		}
		folders = append(folders, folder)
	}

	assignWellKnownRoles(folders)

	if withCounts && !listStatus {
		fillFolderCounts(c, folders)
	}

	sortFolders(folders)
	return folders, nil
}

// assignWellKnownRoles names folders for servers without SPECIAL-USE. A role
// is only assigned when no folder carries it yet, preferring shallow folders.
func assignWellKnownRoles(folders []Folder) {
	taken := map[string]bool{}
	for _, folder := range folders {
		if folder.Role != "" {
			taken[folder.Role] = true
		}
	}
	//Top-level folders first, then "INBOX.Sent" style servers that nest
	//every folder under the inbox
	for depth := 0; depth <= 1; depth++ {
		for i := range folders {
			folder := &folders[i]
			if folder.Role != "" || folder.Depth != depth || !folder.Selectable {
				continue
			}
			if depth == 1 && !strings.EqualFold(folder.Parent, "INBOX") {
				continue
			}
			role, ok := wellKnownFolderNames[strings.ToLower(folder.Display)]
			if !ok || taken[role] {
				continue
			}
			folder.Role = role
			taken[role] = true
		}
	}
}

// fillFolderCounts pipelines STATUS for every selectable folder.
func fillFolderCounts(c *imapclient.Client, folders []Folder) {
	type pending struct {
		index   int
		command *imapclient.StatusCommand
	}
	commands := []pending{}
	for i := range folders {
		if !folders[i].Selectable || len(commands) >= 200 {
			continue
		}
		commands = append(commands, pending{index: i, command: c.Status(folders[i].Name, &imap.StatusOptions{NumMessages: true, NumUnseen: true})})
	}
	for _, item := range commands {
		data, err := item.command.Wait()
		if err != nil || data == nil {
			continue
		}
		if data.NumMessages != nil {
			folders[item.index].Total = int(*data.NumMessages)
		}
		if data.NumUnseen != nil {
			folders[item.index].Unread = int(*data.NumUnseen)
		}
	}
}

// sortFolders puts special folders first and keeps children under parents.
func sortFolders(folders []Folder) {
	rank := func(folder Folder) int {
		if order, ok := roleOrder[folder.Role]; ok {
			return order
		}
		return 100
	}
	sort.SliceStable(folders, func(i, j int) bool {
		ri, rj := rank(folders[i]), rank(folders[j])
		if ri != rj && (ri < 100 || rj < 100) {
			return ri < rj
		}
		return strings.ToLower(folders[i].Name) < strings.ToLower(folders[j].Name)
	})
}

// folderByRole finds the folder playing a role.
func folderByRole(folders []Folder, role string) (Folder, bool) {
	for _, folder := range folders {
		if folder.Role == role && folder.Selectable {
			return folder, true
		}
	}
	return Folder{}, false
}

// roleOf returns the role of a folder by name.
func roleOf(folders []Folder, name string) string {
	for _, folder := range folders {
		if folder.Name == name {
			return folder.Role
		}
	}
	if strings.EqualFold(name, "INBOX") {
		return RoleInbox
	}
	return ""
}

// ensureRoleFolder finds the folder of a role, creating a top-level one with
// a conventional name when the server has none.
func (m *Manager) ensureRoleFolder(c *imapclient.Client, key string, role string) (string, error) {
	folders, err := m.foldersQuick(c, key)
	if err != nil {
		return "", err
	}
	if folder, ok := folderByRole(folders, role); ok {
		return folder.Name, nil
	}

	names := map[string]string{RoleTrash: "Trash", RoleArchive: "Archive", RoleJunk: "Junk", RoleSent: "Sent", RoleDrafts: "Drafts"}
	name, ok := names[role]
	if !ok {
		return "", errors.New("no folder for " + role)
	}
	//The INBOX.Sent convention: create under INBOX when everything lives there
	for _, folder := range folders {
		if folder.Parent != "" && strings.EqualFold(folder.Parent, "INBOX") && folder.Delimiter != "" {
			name = "INBOX" + folder.Delimiter + name
			break
		}
	}
	createOptions := &imap.CreateOptions{}
	attrs := map[string]imap.MailboxAttr{RoleTrash: imap.MailboxAttrTrash, RoleArchive: imap.MailboxAttrArchive,
		RoleJunk: imap.MailboxAttrJunk, RoleSent: imap.MailboxAttrSent, RoleDrafts: imap.MailboxAttrDrafts}
	if c.Caps().Has(imap.CapCreateSpecialUse) {
		createOptions.SpecialUse = []imap.MailboxAttr{attrs[role]}
	}
	if err := c.Create(name, createOptions).Wait(); err != nil {
		var statusErr *imap.Error
		if !(errors.As(err, &statusErr) && statusErr.Code == imap.ResponseCodeAlreadyExists) {
			return "", err
		}
	}
	m.dropFolderCache(key)
	return name, nil
}

// CreateFolder makes a new mailbox, optionally inside parent.
func (m *Manager) CreateFolder(ctx context.Context, p Principal, accountID string, parent string, name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("folder name is empty")
	}
	account, err := m.account(p, accountID)
	if err != nil {
		return "", err
	}
	key := poolKey(p.Username, account.ID)
	full := name
	err = m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		if parent != "" {
			folders, err := m.foldersQuick(c, key)
			if err != nil {
				return err
			}
			delimiter := "/"
			for _, folder := range folders {
				if folder.Name == parent && folder.Delimiter != "" {
					delimiter = folder.Delimiter
				}
			}
			if strings.Contains(name, delimiter) {
				return errors.New("folder name cannot contain \"" + delimiter + "\"")
			}
			full = parent + delimiter + name
		}
		err := c.Create(full, nil).Wait()
		if err == nil {
			c.Subscribe(full).Wait()
		}
		return err
	})
	m.dropFolderCache(key)
	return full, err
}

// RenameFolder renames a mailbox (keeping it under the same parent).
func (m *Manager) RenameFolder(ctx context.Context, p Principal, accountID string, folder string, newName string) (string, error) {
	newName = strings.TrimSpace(newName)
	if newName == "" {
		return "", errors.New("folder name is empty")
	}
	account, err := m.account(p, accountID)
	if err != nil {
		return "", err
	}
	key := poolKey(p.Username, account.ID)
	full := newName
	err = m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		folders, err := m.foldersQuick(c, key)
		if err != nil {
			return err
		}
		var current *Folder
		for i := range folders {
			if folders[i].Name == folder {
				current = &folders[i]
			}
		}
		if current == nil {
			return ErrFolderNotFound
		}
		if current.Role != "" {
			return errors.New("special folders cannot be renamed")
		}
		if current.Parent != "" {
			full = current.Parent + current.Delimiter + newName
		}
		return c.Rename(folder, full, nil).Wait()
	})
	m.dropFolderCache(key)
	return full, err
}

// DeleteFolder removes a mailbox and its messages.
func (m *Manager) DeleteFolder(ctx context.Context, p Principal, accountID string, folder string) error {
	account, err := m.account(p, accountID)
	if err != nil {
		return err
	}
	key := poolKey(p.Username, account.ID)
	err = m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		folders, err := m.foldersQuick(c, key)
		if err != nil {
			return err
		}
		if role := roleOf(folders, folder); role != "" {
			return errors.New("special folders cannot be deleted")
		}
		if selected := c.Mailbox(); selected != nil && selected.Name == folder {
			c.Unselect().Wait()
		}
		c.Unsubscribe(folder).Wait()
		return c.Delete(folder).Wait()
	})
	m.dropFolderCache(key)
	return err
}
