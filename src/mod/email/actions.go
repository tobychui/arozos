package email

/*
	actions.go

	Changing messages: flags, move / copy, delete, archive, junk, mark all
	read, empty folder, and appending new messages (drafts, sent copies,
	imported .eml files).

	Delete follows what users expect from every mainstream client: outside the
	Trash it moves to Trash, inside Trash (or Junk) it deletes for good.
	Archive on Gmail moves to "All Mail", which is how Gmail archives over IMAP.
*/

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
)

// Flag names accepted by SetFlag.
var flagNames = map[string]imap.Flag{
	"seen":      imap.FlagSeen,
	"flagged":   imap.FlagFlagged,
	"answered":  imap.FlagAnswered,
	"forwarded": imap.FlagForwarded,
	"draft":     imap.FlagDraft,
}

// ActionResult reports what a bulk action did.
type ActionResult struct {
	Count       int    `json:"count"`
	Destination string `json:"destination,omitempty"`
	Permanent   bool   `json:"permanent,omitempty"`
}

func uidSetOf(uids []uint32) (imap.UIDSet, error) {
	if len(uids) == 0 {
		return nil, errors.New("no messages selected")
	}
	set := imap.UIDSet{}
	for _, uid := range uids {
		if uid == 0 {
			return nil, errors.New("invalid message id")
		}
		set.AddNum(imap.UID(uid))
	}
	return set, nil
}

// SetFlag adds or removes a flag on messages.
func (m *Manager) SetFlag(ctx context.Context, p Principal, accountID string, folder string, uids []uint32, flag string, value bool) (*ActionResult, error) {
	imapFlag, ok := flagNames[strings.ToLower(flag)]
	if !ok {
		return nil, errors.New("unknown flag " + flag)
	}
	set, err := uidSetOf(uids)
	if err != nil {
		return nil, err
	}
	account, err := m.account(p, accountID)
	if err != nil {
		return nil, err
	}
	err = m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		if _, err := selectFolder(c, folder); err != nil {
			return err
		}
		op := imap.StoreFlagsAdd
		if !value {
			op = imap.StoreFlagsDel
		}
		return c.Store(set, &imap.StoreFlags{Op: op, Silent: true, Flags: []imap.Flag{imapFlag}}, nil).Close()
	})
	if err != nil {
		return nil, err
	}
	return &ActionResult{Count: len(uids)}, nil
}

// Move moves messages to another folder of the same account.
func (m *Manager) Move(ctx context.Context, p Principal, accountID string, folder string, uids []uint32, destination string) (*ActionResult, error) {
	if destination == "" || destination == folder {
		return nil, errors.New("choose a different folder")
	}
	set, err := uidSetOf(uids)
	if err != nil {
		return nil, err
	}
	account, err := m.account(p, accountID)
	if err != nil {
		return nil, err
	}
	err = m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		if _, err := selectFolder(c, folder); err != nil {
			return err
		}
		_, err := c.Move(set, destination).Wait()
		return err
	})
	if err != nil {
		return nil, err
	}
	m.forgetLocalState(p, account.ID, folder, uids)
	return &ActionResult{Count: len(uids), Destination: destination}, nil
}

// Copy copies messages to another folder of the same account.
func (m *Manager) Copy(ctx context.Context, p Principal, accountID string, folder string, uids []uint32, destination string) (*ActionResult, error) {
	set, err := uidSetOf(uids)
	if err != nil {
		return nil, err
	}
	account, err := m.account(p, accountID)
	if err != nil {
		return nil, err
	}
	err = m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		if _, err := selectFolder(c, folder); err != nil {
			return err
		}
		_, err := c.Copy(set, destination).Wait()
		return err
	})
	if err != nil {
		return nil, err
	}
	return &ActionResult{Count: len(uids), Destination: destination}, nil
}

// MoveToRole moves messages to the folder playing a role (trash, archive,
// junk, inbox), creating that folder when the server has none.
func (m *Manager) MoveToRole(ctx context.Context, p Principal, accountID string, folder string, uids []uint32, role string) (*ActionResult, error) {
	set, err := uidSetOf(uids)
	if err != nil {
		return nil, err
	}
	account, err := m.account(p, accountID)
	if err != nil {
		return nil, err
	}
	key := poolKey(p.Username, account.ID)
	result := &ActionResult{Count: len(uids)}

	err = m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		folders, err := m.foldersQuick(c, key)
		if err != nil {
			return err
		}
		currentRole := roleOf(folders, folder)

		var destination string
		switch role {
		case RoleInbox:
			destination = "INBOX"
		case RoleArchive:
			//Gmail archives by moving out of the inbox into All Mail
			if archive, ok := folderByRole(folders, RoleArchive); ok {
				destination = archive.Name
			} else if all, ok := folderByRole(folders, RoleAll); ok {
				destination = all.Name
			} else {
				destination, err = m.ensureRoleFolder(c, key, RoleArchive)
			}
		default:
			destination, err = m.ensureRoleFolder(c, key, role)
		}
		if err != nil {
			return err
		}
		if destination == folder || (role == RoleArchive && (currentRole == RoleAll || currentRole == RoleArchive)) {
			return errors.New("the messages are already there")
		}

		if _, err := selectFolder(c, folder); err != nil {
			return err
		}
		if role == RoleJunk || (role == RoleInbox && currentRole == RoleJunk) {
			//Train the provider's spam filter where keywords are supported
			junkFlag, otherFlag := imap.FlagJunk, imap.FlagNotJunk
			if role == RoleInbox {
				junkFlag, otherFlag = imap.FlagNotJunk, imap.FlagJunk
			}
			c.Store(set, &imap.StoreFlags{Op: imap.StoreFlagsAdd, Silent: true, Flags: []imap.Flag{junkFlag}}, nil).Close()
			c.Store(set, &imap.StoreFlags{Op: imap.StoreFlagsDel, Silent: true, Flags: []imap.Flag{otherFlag}}, nil).Close()
		}
		_, err = c.Move(set, destination).Wait()
		result.Destination = destination
		return err
	})
	if err != nil {
		return nil, err
	}
	m.forgetLocalState(p, account.ID, folder, uids)
	return result, nil
}

// Delete moves messages to Trash, or removes them for good when they already
// are in Trash / Junk or permanent is set.
func (m *Manager) Delete(ctx context.Context, p Principal, accountID string, folder string, uids []uint32, permanent bool) (*ActionResult, error) {
	set, err := uidSetOf(uids)
	if err != nil {
		return nil, err
	}
	account, err := m.account(p, accountID)
	if err != nil {
		return nil, err
	}
	key := poolKey(p.Username, account.ID)
	result := &ActionResult{Count: len(uids)}

	err = m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		folders, err := m.foldersQuick(c, key)
		if err != nil {
			return err
		}
		currentRole := roleOf(folders, folder)
		if !permanent && currentRole != RoleTrash && currentRole != RoleJunk {
			trash, err := m.ensureRoleFolder(c, key, RoleTrash)
			if err != nil {
				//Never fall back to a silent permanent delete
				return errors.New("no Trash folder is available on this account (" + err.Error() + "), delete permanently instead")
			}
			if trash != folder {
				if _, err := selectFolder(c, folder); err != nil {
					return err
				}
				_, err = c.Move(set, trash).Wait()
				result.Destination = trash
				return err
			}
		}

		result.Permanent = true
		if _, err := selectFolder(c, folder); err != nil {
			return err
		}
		return expungeUIDs(c, set)
	})
	if err != nil {
		return nil, err
	}
	m.forgetLocalState(p, account.ID, folder, uids)
	return result, nil
}

// expungeUIDs permanently removes exactly the given messages when the server
// supports UIDPLUS; otherwise EXPUNGE removes every \Deleted message.
func expungeUIDs(c *imapclient.Client, set imap.UIDSet) error {
	if err := c.Store(set, &imap.StoreFlags{Op: imap.StoreFlagsAdd, Silent: true, Flags: []imap.Flag{imap.FlagDeleted}}, nil).Close(); err != nil {
		return err
	}
	if c.Caps().Has(imap.CapUIDPlus) || c.Caps().Has(imap.CapIMAP4rev2) {
		return c.UIDExpunge(set).Close()
	}
	return c.Expunge().Close()
}

// MarkAllRead marks every unread message of a folder as read.
func (m *Manager) MarkAllRead(ctx context.Context, p Principal, accountID string, folder string) (*ActionResult, error) {
	account, err := m.account(p, accountID)
	if err != nil {
		return nil, err
	}
	result := &ActionResult{}
	err = m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		if _, err := selectFolder(c, folder); err != nil {
			return err
		}
		data, err := c.UIDSearch(&imap.SearchCriteria{NotFlag: []imap.Flag{imap.FlagSeen}}, nil).Wait()
		if err != nil {
			return err
		}
		uids := data.AllUIDs()
		if len(uids) == 0 {
			return nil
		}
		result.Count = len(uids)
		return c.Store(imap.UIDSetNum(uids...), &imap.StoreFlags{Op: imap.StoreFlagsAdd, Silent: true, Flags: []imap.Flag{imap.FlagSeen}}, nil).Close()
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// EmptyFolder permanently deletes every message of the Trash or Junk folder.
func (m *Manager) EmptyFolder(ctx context.Context, p Principal, accountID string, folder string) (*ActionResult, error) {
	account, err := m.account(p, accountID)
	if err != nil {
		return nil, err
	}
	key := poolKey(p.Username, account.ID)
	result := &ActionResult{Permanent: true}
	err = m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		folders, err := m.foldersQuick(c, key)
		if err != nil {
			return err
		}
		if role := roleOf(folders, folder); role != RoleTrash && role != RoleJunk {
			return errors.New("only the Trash and Junk folders can be emptied")
		}
		if _, err := selectFolder(c, folder); err != nil {
			return err
		}
		data, err := c.UIDSearch(&imap.SearchCriteria{}, nil).Wait()
		if err != nil {
			return err
		}
		uids := data.AllUIDs()
		result.Count = len(uids)
		if len(uids) == 0 {
			return nil
		}
		return expungeUIDs(c, imap.UIDSetNum(uids...))
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// appendMessage stores a raw message in a folder and returns its UID when
// the server reports it (UIDPLUS), otherwise looks it up by Message-ID.
func appendMessage(c *imapclient.Client, folder string, raw []byte, flags []imap.Flag, date time.Time, messageID string) (uint32, error) {
	options := &imap.AppendOptions{Flags: flags}
	if !date.IsZero() {
		options.Time = date
	}
	command := c.Append(folder, int64(len(raw)), options)
	if _, err := command.Write(raw); err != nil {
		command.Close()
		return 0, err
	}
	if err := command.Close(); err != nil {
		return 0, err
	}
	data, err := command.Wait()
	if err != nil {
		return 0, err
	}
	if data != nil && data.UID != 0 {
		return uint32(data.UID), nil
	}
	if messageID == "" {
		return 0, nil
	}
	if _, err := selectFolder(c, folder); err != nil {
		return 0, nil
	}
	found, err := c.UIDSearch(&imap.SearchCriteria{Header: []imap.SearchCriteriaHeaderField{{Key: "Message-ID", Value: messageID}}}, nil).Wait()
	if err != nil {
		return 0, nil
	}
	uids := found.AllUIDs()
	if len(uids) == 0 {
		return 0, nil
	}
	return uint32(uids[len(uids)-1]), nil
}

// ImportMessage appends a raw RFC 822 message (an .eml file) to a folder.
func (m *Manager) ImportMessage(ctx context.Context, p Principal, accountID string, folder string, raw []byte) (uint32, error) {
	if len(raw) == 0 {
		return 0, errors.New("the message is empty")
	}
	if len(raw) > maxRawMessage {
		return 0, ErrTooLarge
	}
	account, err := m.account(p, accountID)
	if err != nil {
		return 0, err
	}
	header := parseHeaderBytes(raw)
	date, _ := header.Date()
	messageID, _ := header.MessageID()

	var uid uint32
	err = m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		var err error
		uid, err = appendMessage(c, folder, raw, []imap.Flag{imap.FlagSeen}, date, messageID)
		return err
	})
	return uid, err
}
