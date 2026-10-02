package email

/*
	send.go

	Sending and drafts.

	Send renders the message once. With no delay it is delivered right away;
	with an undo delay or a schedule it goes to the outbox, which delivers it
	from the server even if the browser is closed in the meantime.

	After delivery: a copy goes to the Sent folder unless the provider files
	sent mail itself (Gmail, Outlook), the original is flagged answered or
	forwarded, the draft it came from is removed and the recipients are
	remembered for address completion.
*/

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
	"imuslab.com/arozos/mod/info/logger"
)

// SendResult reports what Send did.
type SendResult struct {
	Queued    bool   `json:"queued"`
	OutboxID  string `json:"outboxId,omitempty"`
	SendAt    int64  `json:"sendAt,omitempty"`
	MessageID string `json:"messageId"`
	Warning   string `json:"warning,omitempty"`
}

var draftFlags = []imap.Flag{imap.FlagDraft, imap.FlagSeen}

// DraftResult identifies a saved draft. Attachments lists the draft's parts
// so the composer can keep referring to them (by part id) once the files it
// uploaded are embedded in the draft.
type DraftResult struct {
	Folder      string       `json:"folder"`
	UID         uint32       `json:"uid"`
	Attachments []Attachment `json:"attachments"`
}

// postSend describes the follow-up work of a delivered message.
type postSend struct {
	SaveSent       bool      `json:"saveSent"`
	BccHeader      string    `json:"bccHeader,omitempty"`
	ReplyMode      string    `json:"replyMode,omitempty"`
	OriginalFolder string    `json:"originalFolder,omitempty"`
	OriginalUID    uint32    `json:"originalUid,omitempty"`
	DraftFolder    string    `json:"draftFolder,omitempty"`
	DraftUID       uint32    `json:"draftUid,omitempty"`
	Recipients     []Address `json:"recipients,omitempty"`
}

// shouldSaveSent applies the account's Sent-copy policy.
func shouldSaveSent(account *Account) bool {
	switch account.SaveSent {
	case "always":
		return true
	case "never":
		return false
	}
	provider := account.Provider
	if provider == "custom" || provider == "" {
		if detected := providerForServer(account.SMTP.Host); detected != "" {
			provider = detected
		}
	}
	return presetSavesSent(provider)
}

// Send delivers (or queues) a message.
func (m *Manager) Send(ctx context.Context, p Principal, request *ComposeRequest) (*SendResult, error) {
	account, err := m.account(p, request.AccountID)
	if err != nil {
		return nil, err
	}
	built, err := m.buildMessage(ctx, p, account, request, false)
	if err != nil {
		return nil, err
	}

	post := postSend{
		SaveSent:       shouldSaveSent(account),
		BccHeader:      built.bccHeader,
		ReplyMode:      request.ReplyMode,
		OriginalFolder: request.OriginalFolder,
		OriginalUID:    request.OriginalUID,
		DraftFolder:    request.DraftFolder,
		DraftUID:       request.DraftUID,
		Recipients:     recipientAddresses(request),
	}

	sendAt := time.Time{}
	if request.SendAt > 0 {
		sendAt = time.UnixMilli(request.SendAt)
	}
	if request.UndoSeconds > 0 {
		undoAt := m.now().Add(time.Duration(request.UndoSeconds) * time.Second)
		if sendAt.Before(undoAt) {
			sendAt = undoAt
		}
	}

	if !sendAt.IsZero() && sendAt.After(m.now().Add(time.Second)) {
		item, err := m.outbox.enqueue(p, account, built, post, sendAt, request.Subject, request.To)
		if err != nil {
			return nil, err
		}
		return &SendResult{Queued: true, OutboxID: item.ID, SendAt: item.SendAt, MessageID: built.messageID}, nil
	}

	if err := m.sendRaw(ctx, p, account, built.from, built.recipients, built.raw); err != nil {
		m.noteAuthError(p, account, err)
		return nil, err
	}
	warning := m.afterDelivery(ctx, p, account, built.raw, built.messageID, built.date, post)
	return &SendResult{MessageID: built.messageID, Warning: warning}, nil
}

func recipientAddresses(request *ComposeRequest) []Address {
	results := []Address{}
	for _, list := range [][]string{request.To, request.Cc, request.Bcc} {
		parsed, err := parseRecipients(list)
		if err != nil {
			continue
		}
		for _, address := range parsed {
			results = append(results, Address{Name: address.Name, Email: address.Address})
		}
	}
	return results
}

// afterDelivery runs the follow-up work. Failures here never undo a sent
// message, they are returned as a warning.
func (m *Manager) afterDelivery(ctx context.Context, p Principal, account *Account, raw []byte, messageID string, date time.Time, post postSend) string {
	warnings := []string{}
	key := poolKey(p.Username, account.ID)

	err := m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		if post.SaveSent {
			sent, err := m.ensureRoleFolder(c, key, RoleSent)
			if err == nil {
				copyRaw := raw
				if post.BccHeader != "" {
					copyRaw = append([]byte(post.BccHeader), raw...)
				}
				_, err = appendMessage(c, sent, copyRaw, []imap.Flag{imap.FlagSeen}, date, "")
			}
			if err != nil {
				warnings = append(warnings, "the message was sent but could not be saved to the Sent folder: "+err.Error())
			}
		}

		if post.OriginalUID != 0 && post.OriginalFolder != "" {
			flag := imap.FlagAnswered
			if post.ReplyMode == "forward" {
				flag = imap.FlagForwarded
			}
			if _, err := selectFolder(c, post.OriginalFolder); err == nil {
				c.Store(imap.UIDSetNum(imap.UID(post.OriginalUID)), &imap.StoreFlags{Op: imap.StoreFlagsAdd, Silent: true, Flags: []imap.Flag{flag}}, nil).Close()
			}
		}

		if post.DraftUID != 0 && post.DraftFolder != "" {
			if _, err := selectFolder(c, post.DraftFolder); err == nil {
				expungeUIDs(c, imap.UIDSetNum(imap.UID(post.DraftUID)))
			}
		}
		return nil
	})
	if err != nil {
		warnings = append(warnings, "the message was sent, but the mailbox could not be updated: "+err.Error())
	}

	if m.store.getSettings(p.Username).AutoCollectContacts {
		m.collectContacts(p, post.Recipients)
	}
	if len(warnings) > 0 {
		logger.PrintAndLog("Email", "Post-send step failed for "+account.Email+": "+strings.Join(warnings, "; "), nil)
	}
	return strings.Join(warnings, "; ")
}

// SaveDraft stores the composer content in the Drafts folder, replacing the
// previous version of the same draft.
func (m *Manager) SaveDraft(ctx context.Context, p Principal, request *ComposeRequest) (*DraftResult, error) {
	account, err := m.account(p, request.AccountID)
	if err != nil {
		return nil, err
	}
	built, err := m.buildMessage(ctx, p, account, request, true)
	if err != nil {
		return nil, err
	}

	key := poolKey(p.Username, account.ID)
	result := &DraftResult{}
	err = m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		drafts, err := m.ensureRoleFolder(c, key, RoleDrafts)
		if err != nil {
			return err
		}
		uid, err := appendMessage(c, drafts, built.raw, draftFlags, built.date, built.messageID)
		if err != nil {
			return err
		}
		result.Folder = drafts
		result.UID = uid
		result.Attachments = []Attachment{}
		if uid != 0 {
			if _, err := selectFolder(c, drafts); err == nil {
				structure, err := c.Fetch(imap.UIDSetNum(imap.UID(uid)), &imap.FetchOptions{UID: true, BodyStructure: &imap.FetchItemBodyStructure{Extended: true}}).Collect()
				if err == nil && len(structure) > 0 {
					parts := selectDisplayParts(treeFromBodyStructure(structure[0].BodyStructure))
					for _, attachment := range attachmentInfo(parts.attachments) {
						if !attachment.Inline {
							result.Attachments = append(result.Attachments, attachment)
						}
					}
				}
			}
		}

		//Drop the previous version once the new one is safely stored
		if request.DraftUID != 0 && request.DraftUID != uid {
			previousFolder := request.DraftFolder
			if previousFolder == "" {
				previousFolder = drafts
			}
			if _, err := selectFolder(c, previousFolder); err == nil {
				expungeUIDs(c, imap.UIDSetNum(imap.UID(request.DraftUID)))
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// DeleteDraft removes a draft the user discarded.
func (m *Manager) DeleteDraft(ctx context.Context, p Principal, accountID string, folder string, uid uint32) error {
	if uid == 0 || folder == "" {
		return errors.New("no draft to delete")
	}
	account, err := m.account(p, accountID)
	if err != nil {
		return err
	}
	return m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		if _, err := selectFolder(c, folder); err != nil {
			return err
		}
		return expungeUIDs(c, imap.UIDSetNum(imap.UID(uid)))
	})
}
