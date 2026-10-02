package email

/*
	unified.go

	Views spanning every account: All Inboxes, Starred, Unread, and the cheap
	status poll the app uses to notice new mail.

	Accounts are queried in parallel and merged by arrival time. One broken
	account is reported in Errors instead of failing the whole view.
*/

import (
	"context"
	"sort"
	"strings"
	"sync"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
)

const maxUnifiedWindow = 400

// Unified views.
const (
	ViewInbox   = "inbox"
	ViewFlagged = "flagged"
	ViewUnread  = "unread"
	//"role:<role>" (role:sent, role:drafts, role:trash, …) lists the folder
	//playing that role on every account
)

// UnifiedList merges one view across accounts. accountIDs limits the
// accounts (empty means all).
func (m *Manager) UnifiedList(ctx context.Context, p Principal, view string, accountIDs []string, query ListQuery) (*MessageList, error) {
	query.normalise()
	accounts, err := m.store.listAccounts(p.Username)
	if err != nil {
		return nil, err
	}
	if len(accountIDs) > 0 {
		wanted := map[string]bool{}
		for _, id := range accountIDs {
			wanted[id] = true
		}
		filtered := accounts[:0]
		for _, account := range accounts {
			if wanted[account.ID] {
				filtered = append(filtered, account)
			}
		}
		accounts = filtered
	}

	window := (query.Page + 1) * query.PageSize
	if window > maxUnifiedWindow {
		window = maxUnifiedWindow
	}

	type accountResult struct {
		list *MessageList
		err  error
	}
	results := make([]accountResult, len(accounts))
	var wg sync.WaitGroup
	for index, account := range accounts {
		wg.Add(1)
		go func(index int, account *Account) {
			defer wg.Done()
			accountQuery := query
			accountQuery.Page = 0
			accountQuery.PageSize = window
			accountQuery.Folder = "INBOX"
			accountQuery.Previews = false //Fetched below for the visible page only

			var list *MessageList
			err := m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
				//"role:sent", "role:drafts", … list that folder of every account
				if strings.HasPrefix(view, "role:") {
					folders, err := m.foldersQuick(c, poolKey(p.Username, account.ID))
					if err != nil {
						return err
					}
					folder, ok := folderByRole(folders, strings.TrimPrefix(view, "role:"))
					if !ok {
						list = &MessageList{Messages: []MessageSummary{}}
						return nil
					}
					accountQuery.Folder = folder.Name
				}
				switch view {
				case ViewFlagged:
					folders, err := m.foldersQuick(c, poolKey(p.Username, account.ID))
					if err == nil {
						if starred, ok := folderByRole(folders, RoleFlagged); ok {
							//Gmail keeps every starred message in [Gmail]/Starred
							accountQuery.Folder = starred.Name
						} else {
							accountQuery.Filter = "flagged"
						}
					} else {
						accountQuery.Filter = "flagged"
					}
				case ViewUnread:
					accountQuery.Filter = "unread"
				}
				var err error
				list, err = m.listMessages(c, p, account, accountQuery)
				return err
			})
			if err == nil {
				m.clearAuthError(p, account)
			}
			results[index] = accountResult{list: list, err: err}
		}(index, account)
	}
	wg.Wait()

	merged := &MessageList{Page: query.Page, PageSize: query.PageSize, Messages: []MessageSummary{}}
	all := []MessageSummary{}
	for index, result := range results {
		if result.err != nil {
			merged.Errors = append(merged.Errors, AccountError{
				AccountID:  accounts[index].ID,
				Email:      accounts[index].Email,
				Error:      result.err.Error(),
				AuthFailed: IsAuthError(result.err),
			})
			continue
		}
		merged.Total += result.list.Total
		all = append(all, result.list.Messages...)
	}

	sort.SliceStable(all, func(i, j int) bool {
		a, b := all[i], all[j]
		if a.Received == b.Received {
			//INTERNALDATE has one second precision; break ties on the header date
			a.Received, b.Received = a.Date, b.Date
		}
		if query.Sort == "date_asc" {
			return a.Received < b.Received
		}
		return a.Received > b.Received
	})

	begin := query.Page * query.PageSize
	if begin < len(all) {
		end := begin + query.PageSize
		if end > len(all) {
			end = len(all)
		}
		merged.Messages = append(merged.Messages, all[begin:end]...)
	}

	if query.Previews {
		m.previewsForMixed(ctx, p, accounts, merged.Messages)
	}
	m.applyLocalState(p, merged.Messages)
	return merged, nil
}

// previewsForMixed fills previews of a page that spans several accounts and
// folders, grouping fetches per account and folder.
func (m *Manager) previewsForMixed(ctx context.Context, p Principal, accounts []*Account, messages []MessageSummary) {
	byAccount := map[string]*Account{}
	for _, account := range accounts {
		byAccount[account.ID] = account
	}
	type group struct {
		indexes []int
	}
	groups := map[string]map[string]*group{}
	for index, message := range messages {
		key := previewKey(p.Username, message.AccountID, message.Folder, message.UIDValidity, message.UID)
		if cached, ok := m.previews.get(key); ok {
			messages[index].Preview = cached
			continue
		}
		if groups[message.AccountID] == nil {
			groups[message.AccountID] = map[string]*group{}
		}
		if groups[message.AccountID][message.Folder] == nil {
			groups[message.AccountID][message.Folder] = &group{}
		}
		groups[message.AccountID][message.Folder].indexes = append(groups[message.AccountID][message.Folder].indexes, index)
	}

	var wg sync.WaitGroup
	var mutex sync.Mutex
	for accountID, folders := range groups {
		account, ok := byAccount[accountID]
		if !ok {
			continue
		}
		wg.Add(1)
		go func(account *Account, folders map[string]*group) {
			defer wg.Done()
			m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
				for folder, group := range folders {
					selected, err := selectFolder(c, folder)
					if err != nil {
						continue
					}
					uids := []imap.UID{}
					for _, index := range group.indexes {
						uids = append(uids, imap.UID(messages[index].UID))
					}
					buffers, err := c.Fetch(imap.UIDSetNum(uids...), &imap.FetchOptions{
						UID: true, BodyStructure: &imap.FetchItemBodyStructure{Extended: true},
					}).Collect()
					if err != nil {
						continue
					}
					previews := make([]MessageSummary, len(buffers))
					m.fillPreviews(c, p.Username, account.ID, folder, selected.UIDValidity, buffers, previews)
					mutex.Lock()
					for i, buffer := range buffers {
						for _, index := range group.indexes {
							if messages[index].UID == uint32(buffer.UID) {
								messages[index].Preview = previews[i].Preview
							}
						}
					}
					mutex.Unlock()
				}
				return nil
			})
		}(account, folders)
	}
	wg.Wait()
}

// InboxStatus is the poll result for one account.
type InboxStatus struct {
	AccountID  string `json:"accountId"`
	Unread     int    `json:"unread"`
	Total      int    `json:"total"`
	UIDNext    uint32 `json:"uidNext"`
	Error      string `json:"error,omitempty"`
	AuthFailed bool   `json:"authFailed,omitempty"`
}

// CheckInboxes runs STATUS on every account's INBOX. The browser compares
// UIDNext with the previous poll to find newly arrived mail.
func (m *Manager) CheckInboxes(ctx context.Context, p Principal) ([]InboxStatus, error) {
	accounts, err := m.store.listAccounts(p.Username)
	if err != nil {
		return nil, err
	}
	m.wakeSnoozed(p)

	results := make([]InboxStatus, len(accounts))
	var wg sync.WaitGroup
	for index, account := range accounts {
		wg.Add(1)
		go func(index int, account *Account) {
			defer wg.Done()
			status := InboxStatus{AccountID: account.ID}
			err := m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
				//STATUS on the selected mailbox is not allowed by every server
				if selected := c.Mailbox(); selected != nil && selected.Name == "INBOX" {
					c.Unselect().Wait()
				}
				data, err := c.Status("INBOX", &imap.StatusOptions{NumMessages: true, NumUnseen: true, UIDNext: true}).Wait()
				if err != nil {
					return err
				}
				if data.NumUnseen != nil {
					status.Unread = int(*data.NumUnseen)
				}
				if data.NumMessages != nil {
					status.Total = int(*data.NumMessages)
				}
				status.UIDNext = uint32(data.UIDNext)
				return nil
			})
			if err != nil {
				status.Error = err.Error()
				status.AuthFailed = IsAuthError(err)
			} else {
				m.clearAuthError(p, account)
			}
			results[index] = status
		}(index, account)
	}
	wg.Wait()
	return results, nil
}

// NewSince lists INBOX messages with a UID at or above since, used to word
// new-mail notifications.
func (m *Manager) NewSince(ctx context.Context, p Principal, accountID string, since uint32, limit int) ([]MessageSummary, error) {
	account, err := m.account(p, accountID)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 20 {
		limit = 5
	}
	results := []MessageSummary{}
	err = m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		selected, err := selectFolder(c, "INBOX")
		if err != nil {
			return err
		}
		if since == 0 {
			return nil
		}
		set := imap.UIDSet{}
		set.AddRange(imap.UID(since), 0)
		data, err := c.UIDSearch(&imap.SearchCriteria{UID: []imap.UIDSet{set}, NotFlag: []imap.Flag{imap.FlagSeen}}, nil).Wait()
		if err != nil {
			return err
		}
		uids := data.AllUIDs()
		filtered := uids[:0]
		for _, uid := range uids {
			if uint32(uid) >= since {
				filtered = append(filtered, uid)
			}
		}
		if len(filtered) == 0 {
			return nil
		}
		sort.Slice(filtered, func(i, j int) bool { return filtered[i] > filtered[j] })
		if len(filtered) > limit {
			filtered = filtered[:limit]
		}
		buffers, err := c.Fetch(imap.UIDSetNum(filtered...), listFetchOptions).Collect()
		if err != nil {
			return err
		}
		for _, buffer := range buffers {
			results = append(results, summaryFromBuffer(account.ID, "INBOX", selected.UIDValidity, buffer))
		}
		sort.Slice(results, func(i, j int) bool { return results[i].UID > results[j].UID })
		return nil
	})
	return results, err
}
