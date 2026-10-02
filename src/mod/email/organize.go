package email

/*
	organize.go

	Labels and snoozing, kept locally per ArozOS user.

	IMAP keywords would be the natural home for labels, but Gmail and Outlook
	do not accept custom keywords over IMAP, so labels and snoozes are stored
	here and work the same for every provider. Messages are identified by
	account + Message-ID, which survives moving a message between folders;
	mail without a Message-ID falls back to folder + UID.

	A snoozed message stays where it is on the server; the app hides it until
	the snooze ends, then it reappears marked unread.
*/

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
)

// Label is a user-defined, coloured tag.
type Label struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// localMessage is a labelled or snoozed message with the summary needed to
// list it without asking the server.
type localMessage struct {
	Key     string         `json:"key"`
	Labels  []string       `json:"labels,omitempty"`
	Until   int64          `json:"until,omitempty"` //Snooze end, unix ms
	Summary MessageSummary `json:"summary"`
}

var defaultLabels = []Label{
	{ID: "work", Name: "Work", Color: "#3b82f6"},
	{ID: "personal", Name: "Personal", Color: "#22c55e"},
	{ID: "important", Name: "Important", Color: "#ef4444"},
	{ID: "followup", Name: "Follow Up", Color: "#f59e0b"},
	{ID: "newsletters", Name: "Newsletters", Color: "#a855f7"},
}

func localKey(accountID string, messageID string, folder string, uid uint32) string {
	messageID = strings.ToLower(strings.Trim(strings.TrimSpace(messageID), "<>"))
	if messageID != "" {
		return accountID + ":mid:" + messageID
	}
	return accountID + ":uid:" + folder + ":" + strconv.FormatUint(uint64(uid), 10)
}

func summaryKey(summary MessageSummary) string {
	return localKey(summary.AccountID, summary.MessageID, summary.Folder, summary.UID)
}

// Labels returns the user's label definitions.
func (m *Manager) Labels(p Principal) []Label {
	labels := []Label{}
	if m.store.db.KeyExists(tableLabels, p.Username) {
		if err := m.store.db.Read(tableLabels, p.Username, &labels); err == nil {
			return labels
		}
	}
	return append(labels, defaultLabels...)
}

// SaveLabels replaces the label definitions. Labels removed from the list are
// also removed from every message.
func (m *Manager) SaveLabels(p Principal, labels []Label) ([]Label, error) {
	if len(labels) > 60 {
		return nil, errors.New("too many labels")
	}
	cleaned := []Label{}
	seen := map[string]bool{}
	for _, label := range labels {
		label.Name = strings.TrimSpace(label.Name)
		if label.Name == "" {
			continue
		}
		if len([]rune(label.Name)) > 40 {
			label.Name = string([]rune(label.Name)[:40])
		}
		if label.ID == "" {
			label.ID = randomID(5)
		}
		if seen[label.ID] {
			continue
		}
		seen[label.ID] = true
		if !strings.HasPrefix(label.Color, "#") || len(label.Color) > 9 {
			label.Color = "#64748b"
		}
		cleaned = append(cleaned, label)
	}

	m.store.mutex.Lock()
	defer m.store.mutex.Unlock()
	if err := m.store.db.Write(tableLabels, p.Username, cleaned); err != nil {
		return nil, err
	}

	//Strip deleted labels from messages
	records, _ := listOwned[localMessage](m.store, tableLabelMap, p.Username)
	for _, record := range records {
		kept := []string{}
		for _, id := range record.Labels {
			if seen[id] {
				kept = append(kept, id)
			}
		}
		key := ownerKey(p.Username, record.Key)
		if len(kept) == 0 {
			m.store.db.Delete(tableLabelMap, key)
		} else if len(kept) != len(record.Labels) {
			record.Labels = kept
			m.store.db.Write(tableLabelMap, key, record)
		}
	}
	return cleaned, nil
}

// SetMessageLabels assigns labels to a message.
func (m *Manager) SetMessageLabels(p Principal, summary MessageSummary, labelIDs []string) error {
	if _, err := m.account(p, summary.AccountID); err != nil {
		return err
	}
	known := map[string]bool{}
	for _, label := range m.Labels(p) {
		known[label.ID] = true
	}
	labels := []string{}
	for _, id := range labelIDs {
		if known[id] {
			labels = append(labels, id)
		}
	}

	m.store.mutex.Lock()
	defer m.store.mutex.Unlock()
	key := summaryKey(summary)
	dbKey := ownerKey(p.Username, key)
	if len(labels) == 0 {
		if m.store.db.KeyExists(tableLabelMap, dbKey) {
			return m.store.db.Delete(tableLabelMap, dbKey)
		}
		return nil
	}
	summary.Labels = labels
	summary.Preview = previewText(summary.Preview, 180)
	return m.store.db.Write(tableLabelMap, dbKey, localMessage{Key: key, Labels: labels, Summary: summary})
}

// LabelMessages lists the messages carrying a label, newest first.
func (m *Manager) LabelMessages(p Principal, labelID string) ([]MessageSummary, error) {
	records, err := listOwned[localMessage](m.store, tableLabelMap, p.Username)
	if err != nil {
		return nil, err
	}
	results := []MessageSummary{}
	for _, record := range records {
		for _, id := range record.Labels {
			if id == labelID {
				summary := record.Summary
				summary.Labels = record.Labels
				results = append(results, summary)
				break
			}
		}
	}
	sort.Slice(results, func(i, j int) bool { return results[i].Received > results[j].Received })
	m.applyLocalState(p, results)
	return results, nil
}

// Snooze hides a message until a time (unix ms).
func (m *Manager) Snooze(p Principal, summary MessageSummary, until int64) error {
	if _, err := m.account(p, summary.AccountID); err != nil {
		return err
	}
	if until <= m.now().UnixMilli() {
		return errors.New("choose a time in the future")
	}
	key := summaryKey(summary)
	summary.Preview = previewText(summary.Preview, 180)
	m.store.mutex.Lock()
	defer m.store.mutex.Unlock()
	return m.store.db.Write(tableSnooze, ownerKey(p.Username, key), localMessage{Key: key, Until: until, Summary: summary})
}

// Unsnooze brings a snoozed message back now.
func (m *Manager) Unsnooze(p Principal, summary MessageSummary) error {
	dbKey := ownerKey(p.Username, summaryKey(summary))
	m.store.mutex.Lock()
	defer m.store.mutex.Unlock()
	if m.store.db.KeyExists(tableSnooze, dbKey) {
		return m.store.db.Delete(tableSnooze, dbKey)
	}
	return nil
}

// SnoozedMessages lists snoozed mail, soonest first.
func (m *Manager) SnoozedMessages(p Principal) ([]MessageSummary, error) {
	m.wakeSnoozed(p)
	records, err := listOwned[localMessage](m.store, tableSnooze, p.Username)
	if err != nil {
		return nil, err
	}
	sort.Slice(records, func(i, j int) bool { return records[i].Until < records[j].Until })
	results := []MessageSummary{}
	for _, record := range records {
		summary := record.Summary
		summary.SnoozedUntil = record.Until
		results = append(results, summary)
	}
	m.applyLocalState(p, results)
	return results, nil
}

// wakeSnoozed ends expired snoozes and marks those messages unread so they
// stand out when they come back.
func (m *Manager) wakeSnoozed(p Principal) {
	records, err := listOwned[localMessage](m.store, tableSnooze, p.Username)
	if err != nil {
		return
	}
	now := m.now().UnixMilli()
	woken := map[string][]MessageSummary{}
	m.store.mutex.Lock()
	for _, record := range records {
		if record.Until > now {
			continue
		}
		m.store.db.Delete(tableSnooze, ownerKey(p.Username, record.Key))
		woken[record.Summary.AccountID] = append(woken[record.Summary.AccountID], record.Summary)
	}
	m.store.mutex.Unlock()

	for accountID, summaries := range woken {
		account, err := m.account(p, accountID)
		if err != nil {
			continue
		}
		go func(account *Account, summaries []MessageSummary) {
			m.withIMAP(context.Background(), p, account, func(c *imapclient.Client) error {
				byFolder := map[string][]imap.UID{}
				for _, summary := range summaries {
					byFolder[summary.Folder] = append(byFolder[summary.Folder], imap.UID(summary.UID))
				}
				for folder, uids := range byFolder {
					if _, err := selectFolder(c, folder); err != nil {
						continue
					}
					c.Store(imap.UIDSetNum(uids...), &imap.StoreFlags{Op: imap.StoreFlagsDel, Silent: true, Flags: []imap.Flag{imap.FlagSeen}}, nil).Close()
				}
				return nil
			})
		}(account, summaries)
	}
}

// applyLocalState attaches labels and snooze times to listed messages.
func (m *Manager) applyLocalState(p Principal, summaries []MessageSummary) {
	if len(summaries) == 0 {
		return
	}
	labelled, _ := listOwned[localMessage](m.store, tableLabelMap, p.Username)
	snoozed, _ := listOwned[localMessage](m.store, tableSnooze, p.Username)
	if len(labelled) == 0 && len(snoozed) == 0 {
		return
	}
	labels := map[string][]string{}
	for _, record := range labelled {
		labels[record.Key] = record.Labels
	}
	until := map[string]int64{}
	for _, record := range snoozed {
		until[record.Key] = record.Until
	}
	for i := range summaries {
		key := summaryKey(summaries[i])
		if assigned, ok := labels[key]; ok {
			summaries[i].Labels = assigned
		}
		if end, ok := until[key]; ok {
			summaries[i].SnoozedUntil = end
		}
	}
}

// forgetLocalState drops folder+UID keyed records of messages that moved or
// were deleted; Message-ID keyed records stay valid.
func (m *Manager) forgetLocalState(p Principal, accountID string, folder string, uids []uint32) {
	m.store.mutex.Lock()
	defer m.store.mutex.Unlock()
	for _, uid := range uids {
		key := ownerKey(p.Username, localKey(accountID, "", folder, uid))
		for _, table := range []string{tableLabelMap, tableSnooze} {
			if m.store.db.KeyExists(table, key) {
				m.store.db.Delete(table, key)
			}
		}
	}
}

// LocatedMessage is where a message currently lives.
type LocatedMessage struct {
	Folder string `json:"folder"`
	UID    uint32 `json:"uid"`
}

// LocateMessage finds a message by Message-ID after it moved, searching the
// likely folders first.
func (m *Manager) LocateMessage(ctx context.Context, p Principal, accountID string, messageID string, hint string) (*LocatedMessage, error) {
	messageID = strings.Trim(strings.TrimSpace(messageID), "<>")
	if messageID == "" {
		return nil, ErrMessageNotFound
	}
	account, err := m.account(p, accountID)
	if err != nil {
		return nil, err
	}
	key := poolKey(p.Username, account.ID)
	var located *LocatedMessage
	err = m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		folders, err := m.foldersQuick(c, key)
		if err != nil {
			return err
		}
		order := []string{}
		seen := map[string]bool{}
		add := func(name string) {
			if name != "" && !seen[name] {
				seen[name] = true
				order = append(order, name)
			}
		}
		add(hint)
		add("INBOX")
		for _, role := range []string{RoleAll, RoleArchive, RoleSent, RoleDrafts, RoleJunk, RoleTrash} {
			if folder, ok := folderByRole(folders, role); ok {
				add(folder.Name)
			}
		}
		for _, folder := range folders {
			if folder.Selectable && len(order) < 40 {
				add(folder.Name)
			}
		}
		criteria := &imap.SearchCriteria{Header: []imap.SearchCriteriaHeaderField{{Key: "Message-ID", Value: messageID}}}
		for _, folder := range order {
			if _, err := selectFolder(c, folder); err != nil {
				continue
			}
			data, err := c.UIDSearch(criteria, nil).Wait()
			if err != nil {
				continue
			}
			if uids := data.AllUIDs(); len(uids) > 0 {
				located = &LocatedMessage{Folder: folder, UID: uint32(uids[len(uids)-1])}
				return nil
			}
		}
		return ErrMessageNotFound
	})
	return located, err
}
