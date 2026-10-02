package email

/*
	outbox.go

	Delayed and scheduled delivery.

	"Undo send" and "Send later" both park the rendered message here. The raw
	message is spooled to a 0600 file under the mail data folder and a record
	describes who sends it, when, and what to do afterwards. A background
	ticker delivers due items from the server, so closing the browser never
	loses or blocks a message.

	Failed deliveries are retried with a growing delay; after the last attempt
	the item stays in the outbox as failed and the user is notified.
*/

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/emersion/go-imap/v2/imapclient"
	"imuslab.com/arozos/mod/info/logger"
)

var retryDelays = []time.Duration{time.Minute, 5 * time.Minute, 15 * time.Minute, time.Hour}

// OutboxItem is a queued message.
type OutboxItem struct {
	ID         string   `json:"id"`
	Owner      string   `json:"owner"`
	Admin      bool     `json:"admin"` //Network policy of the user who queued it
	AccountID  string   `json:"accountId"`
	Subject    string   `json:"subject"`
	To         []string `json:"to"`
	From       string   `json:"from"`
	Recipients []string `json:"recipients"`
	MessageID  string   `json:"messageId"`
	Created    int64    `json:"created"`
	SendAt     int64    `json:"sendAt"` //Unix ms
	Status     string   `json:"status"` //queued | sending | failed
	Attempts   int      `json:"attempts"`
	Error      string   `json:"error,omitempty"`
	Post       postSend `json:"post"`
	Date       int64    `json:"date"`
}

// OutboxView is what the browser sees.
type OutboxView struct {
	ID        string   `json:"id"`
	AccountID string   `json:"accountId"`
	Subject   string   `json:"subject"`
	To        []string `json:"to"`
	SendAt    int64    `json:"sendAt"`
	Status    string   `json:"status"`
	Attempts  int      `json:"attempts"`
	Error     string   `json:"error,omitempty"`
	Created   int64    `json:"created"`
}

type outbox struct {
	manager  *Manager
	spoolDir string
	mutex    sync.Mutex
	busy     bool
}

func newOutbox(manager *Manager, spoolDir string) *outbox {
	box := &outbox{manager: manager, spoolDir: spoolDir}
	//Items interrupted mid-delivery by a restart are retried
	items, err := box.all()
	if err == nil {
		for _, item := range items {
			if item.Status == "sending" {
				item.Status = "queued"
				box.save(item)
			}
		}
	}
	return box
}

func (o *outbox) spoolPath(id string) string {
	return filepath.Join(o.spoolDir, id+".eml")
}

func (o *outbox) save(item *OutboxItem) error {
	return o.manager.store.db.Write(tableOutbox, ownerKey(item.Owner, item.ID), item)
}

func (o *outbox) all() ([]*OutboxItem, error) {
	entries, err := o.manager.store.db.ListTable(tableOutbox)
	if err != nil {
		return nil, err
	}
	items := []*OutboxItem{}
	for _, entry := range entries {
		if len(entry) < 2 {
			continue
		}
		item := &OutboxItem{}
		if err := json.Unmarshal(entry[1], item); err != nil || item.ID == "" {
			continue
		}
		items = append(items, item)
	}
	return items, nil
}

func (o *outbox) get(owner string, id string) (*OutboxItem, error) {
	key := ownerKey(owner, id)
	if !o.manager.store.db.KeyExists(tableOutbox, key) {
		return nil, errors.New("this message is no longer in the outbox")
	}
	item := &OutboxItem{}
	if err := o.manager.store.db.Read(tableOutbox, key, item); err != nil {
		return nil, err
	}
	if item.Owner != owner {
		return nil, errors.New("this message is no longer in the outbox")
	}
	return item, nil
}

func (o *outbox) remove(item *OutboxItem) {
	o.manager.store.db.Delete(tableOutbox, ownerKey(item.Owner, item.ID))
	os.Remove(o.spoolPath(item.ID))
}

func (o *outbox) enqueue(p Principal, account *Account, built *builtMessage, post postSend, sendAt time.Time, subject string, to []string) (*OutboxItem, error) {
	item := &OutboxItem{
		ID:         randomID(10),
		Owner:      p.Username,
		Admin:      p.Admin,
		AccountID:  account.ID,
		Subject:    strings.TrimSpace(subject),
		To:         to,
		From:       built.from,
		Recipients: built.recipients,
		MessageID:  built.messageID,
		Created:    o.manager.now().UnixMilli(),
		SendAt:     sendAt.UnixMilli(),
		Status:     "queued",
		Post:       post,
		Date:       built.date.Unix(),
	}
	if err := os.WriteFile(o.spoolPath(item.ID), built.raw, 0600); err != nil {
		return nil, err
	}
	if err := o.save(item); err != nil {
		os.Remove(o.spoolPath(item.ID))
		return nil, err
	}
	return item, nil
}

// processDue delivers every item whose time has come.
func (o *outbox) processDue(ctx context.Context) {
	o.mutex.Lock()
	if o.busy {
		o.mutex.Unlock()
		return
	}
	o.busy = true
	o.mutex.Unlock()
	defer func() {
		o.mutex.Lock()
		o.busy = false
		o.mutex.Unlock()
	}()

	items, err := o.all()
	if err != nil {
		return
	}
	now := o.manager.now().UnixMilli()
	for _, item := range items {
		if item.Status != "queued" || item.SendAt > now {
			continue
		}
		o.deliver(ctx, item)
	}
}

func (o *outbox) deliver(ctx context.Context, item *OutboxItem) {
	m := o.manager
	p := Principal{Username: item.Owner, Admin: item.Admin}

	//Claim the item under the lock OutboxCancel takes, so a cancel either
	//wins outright or sees "sending" and refuses
	o.mutex.Lock()
	current, err := o.get(item.Owner, item.ID)
	if err != nil || current.Status != "queued" {
		o.mutex.Unlock()
		return
	}
	item = current
	item.Status = "sending"
	o.save(item)
	o.mutex.Unlock()

	fail := func(err error) {
		item.Attempts++
		item.Error = err.Error()
		if item.Attempts > len(retryDelays) || IsAuthError(err) || errors.Is(err, ErrAccountNotFound) || errors.Is(err, ErrTooLarge) {
			item.Status = "failed"
			o.save(item)
			logger.PrintAndLog("Email", "Scheduled message to "+strings.Join(item.Recipients, ", ")+" failed permanently", err)
			if m.options.Notify != nil {
				m.options.Notify(item.Owner, "Message not sent", "\""+item.Subject+"\" could not be delivered: "+err.Error())
			}
			return
		}
		item.Status = "queued"
		item.SendAt = m.now().Add(retryDelays[item.Attempts-1]).UnixMilli()
		o.save(item)
	}

	account, err := m.account(p, item.AccountID)
	if err != nil {
		fail(err)
		return
	}
	raw, err := os.ReadFile(o.spoolPath(item.ID))
	if err != nil {
		fail(errors.New("the queued message file is missing"))
		return
	}

	sendCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	if err := m.sendRaw(sendCtx, p, account, item.From, item.Recipients, raw); err != nil {
		m.noteAuthError(p, account, err)
		fail(err)
		return
	}
	o.remove(item)
	m.afterDelivery(sendCtx, p, account, raw, item.MessageID, time.Unix(item.Date, 0), item.Post)
}

// dropAccount removes the queued mail of a deleted account.
func (o *outbox) dropAccount(owner string, accountID string) {
	items, err := o.all()
	if err != nil {
		return
	}
	for _, item := range items {
		if item.Owner == owner && item.AccountID == accountID {
			o.remove(item)
		}
	}
}

// Outbox lists a user's queued and failed messages.
func (m *Manager) Outbox(p Principal) ([]OutboxView, error) {
	items, err := m.outbox.all()
	if err != nil {
		return nil, err
	}
	views := []OutboxView{}
	for _, item := range items {
		if item.Owner != p.Username {
			continue
		}
		views = append(views, OutboxView{
			ID: item.ID, AccountID: item.AccountID, Subject: item.Subject, To: item.To,
			SendAt: item.SendAt, Status: item.Status, Attempts: item.Attempts, Error: item.Error, Created: item.Created,
		})
	}
	sort.Slice(views, func(i, j int) bool { return views[i].SendAt < views[j].SendAt })
	return views, nil
}

// OutboxCancel stops a queued message. toDrafts saves it to the Drafts folder
// so a scheduled message can be edited.
func (m *Manager) OutboxCancel(ctx context.Context, p Principal, id string, toDrafts bool) (*DraftResult, error) {
	m.outbox.mutex.Lock()
	item, err := m.outbox.get(p.Username, id)
	if err != nil {
		m.outbox.mutex.Unlock()
		return nil, err
	}
	if item.Status == "sending" {
		m.outbox.mutex.Unlock()
		return nil, errors.New("the message is already being sent")
	}
	raw, readErr := os.ReadFile(m.outbox.spoolPath(item.ID))
	m.outbox.remove(item)
	m.outbox.mutex.Unlock()

	if !toDrafts || readErr != nil {
		return nil, nil
	}
	account, err := m.account(p, item.AccountID)
	if err != nil {
		return nil, err
	}
	if item.Post.BccHeader != "" {
		raw = append([]byte(item.Post.BccHeader), raw...)
	}
	result := &DraftResult{}
	key := poolKey(p.Username, account.ID)
	err = m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		drafts, err := m.ensureRoleFolder(c, key, RoleDrafts)
		if err != nil {
			return err
		}
		uid, err := appendMessage(c, drafts, raw, draftFlags, time.Unix(item.Date, 0), item.MessageID)
		result.Folder = drafts
		result.UID = uid
		return err
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// OutboxSendNow delivers a queued or failed message at the next tick.
func (m *Manager) OutboxSendNow(p Principal, id string) error {
	m.outbox.mutex.Lock()
	defer m.outbox.mutex.Unlock()
	item, err := m.outbox.get(p.Username, id)
	if err != nil {
		return err
	}
	if item.Status == "sending" {
		return nil
	}
	item.Status = "queued"
	item.SendAt = m.now().UnixMilli()
	if item.Attempts > len(retryDelays) {
		item.Attempts = 0
	}
	return m.outbox.save(item)
}
