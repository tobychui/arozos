package email

/*
	store.go

	Persistence. Mail data lives in its own key-value file (system/mail/mail.db)
	rather than the shared ao.db, so the generic AGI database helpers that any
	script can call never reach another user's account list or contacts.

	Records are keyed "<owner>/<id>" so one user's data is always found by
	prefix and can never be addressed from another account.
*/

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"

	"imuslab.com/arozos/mod/info/logger"
)

const (
	tableAccounts = "accounts"
	tableSettings = "settings"
	tableContacts = "contacts"
	tableLabels   = "labels"
	tableLabelMap = "labelmap"
	tableSnooze   = "snooze"
	tableOutbox   = "outbox"
	tableConfig   = "config"

	adminConfigKey = "admin"
)

// KVStore is the slice of mod/database the mail backend needs. Declared as an
// interface so tests can run against a throwaway bolt file.
type KVStore interface {
	NewTable(tableName string) error
	Write(tableName string, key string, value interface{}) error
	Read(tableName string, key string, assignee interface{}) error
	KeyExists(tableName string, key string) bool
	Delete(tableName string, key string) error
	ListTable(tableName string) ([][][]byte, error)
}

// store wraps the KV file with typed helpers.
type store struct {
	db    KVStore
	mutex sync.Mutex //Serialises read-modify-write sequences
}

func newStore(db KVStore) (out0 *store, out1 error) {
	defer logger.Out2(logger.In1("email", "newStore", "&db", &db), &out0, &out1)
	if db == nil {
		return nil, errors.New("mail store requires a database")
	}
	for _, table := range []string{tableAccounts, tableSettings, tableContacts, tableLabels,
		tableLabelMap, tableSnooze, tableOutbox, tableConfig} {
		if err := db.NewTable(table); err != nil {
			logger.DebugErr("email", err)
			return nil, err
		}
	}
	return &store{db: db}, nil
}

func ownerKey(owner string, id string) string {
	logger.DebugTrace("email", "ownerKey")
	return owner + "/" + id
}

// listOwned decodes every record of a table that belongs to owner.
func listOwned[T any](s *store, table string, owner string) (out0 []T, out1 error) {
	defer logger.Out2(logger.In3("email", "listOwned", "s", s, "table", table, "owner", owner), &out0, &out1)
	entries, err := s.db.ListTable(table)
	if err != nil {
		logger.DebugErr("email", err)
		return nil, err
	}
	prefix := owner + "/"
	results := []T{}
	for _, entry := range entries {
		if len(entry) < 2 || !strings.HasPrefix(string(entry[0]), prefix) {
			continue
		}
		var record T
		if err := json.Unmarshal(entry[1], &record); err != nil {
			logger.DebugErr("email", err)
			continue
		}
		results = append(results, record)
	}
	return results, nil
}

/*
	Accounts
*/

func (s *store) listAccounts(owner string) (out0 []*Account, out1 error) {
	defer logger.Out2(logger.In2("email", "store.listAccounts", "s", s, "owner", owner), &out0, &out1)
	records, err := listOwned[Account](s, tableAccounts, owner)
	if err != nil {
		logger.DebugErr("email", err)
		return nil, err
	}
	accounts := make([]*Account, 0, len(records))
	for i := range records {
		if records[i].Owner != owner {
			continue
		}
		accounts = append(accounts, &records[i])
	}
	sort.SliceStable(accounts, func(i, j int) bool {
		if accounts[i].Order != accounts[j].Order {
			return accounts[i].Order < accounts[j].Order
		}
		return accounts[i].Created < accounts[j].Created
	})
	return accounts, nil
}

func (s *store) getAccount(owner string, id string) (out0 *Account, out1 error) {
	defer logger.Out2(logger.In3("email", "store.getAccount", "s", s, "owner", owner, "id", id), &out0, &out1)
	key := ownerKey(owner, id)
	if id == "" || !s.db.KeyExists(tableAccounts, key) {
		return nil, ErrAccountNotFound
	}
	account := Account{}
	if err := s.db.Read(tableAccounts, key, &account); err != nil {
		logger.DebugErr("email", err)
		return nil, err
	}
	if account.Owner != owner || account.ID != id {
		return nil, ErrAccountNotFound
	}
	return &account, nil
}

func (s *store) saveAccount(account *Account) (out0 error) {
	defer logger.Out1(logger.In2("email", "store.saveAccount", "s", s, "account", account), &out0)
	if account.Owner == "" || account.ID == "" {
		return errors.New("account owner and id are required")
	}
	return s.db.Write(tableAccounts, ownerKey(account.Owner, account.ID), account)
}

func (s *store) deleteAccount(owner string, id string) (out0 error) {
	defer logger.Out1(logger.In3("email", "store.deleteAccount", "s", s, "owner", owner, "id", id), &out0)
	key := ownerKey(owner, id)
	if !s.db.KeyExists(tableAccounts, key) {
		return ErrAccountNotFound
	}
	return s.db.Delete(tableAccounts, key)
}

/*
	Settings
*/

func (s *store) getSettings(owner string) (out0 UserSettings) {
	defer logger.Out1(logger.In2("email", "store.getSettings", "s", s, "owner", owner), &out0)
	settings := DefaultUserSettings()
	if s.db.KeyExists(tableSettings, owner) {
		stored := DefaultUserSettings()
		if err := s.db.Read(tableSettings, owner, &stored); err == nil {
			settings = stored
		}
	}
	settings.normalise()
	return settings
}

func (s *store) saveSettings(owner string, settings UserSettings) (out0 error) {
	defer logger.Out1(logger.In3("email", "store.saveSettings", "s", s, "owner", owner, "&settings", &settings), &out0)
	settings.normalise()
	return s.db.Write(tableSettings, owner, settings)
}

/*
	Admin configuration
*/

func (s *store) getAdminConfig() (out0 AdminConfig) {
	defer logger.Out1(logger.In1("email", "store.getAdminConfig", "s", s), &out0)
	config := defaultAdminConfig()
	if s.db.KeyExists(tableConfig, adminConfigKey) {
		stored := defaultAdminConfig()
		if err := s.db.Read(tableConfig, adminConfigKey, &stored); err == nil {
			config = stored
		}
	}
	config.normalise()
	return config
}

func (s *store) saveAdminConfig(config AdminConfig) (out0 error) {
	defer logger.Out1(logger.In2("email", "store.saveAdminConfig", "s", s, "&config", &config), &out0)
	config.normalise()
	return s.db.Write(tableConfig, adminConfigKey, config)
}

// deleteOwnedWithPrefix removes every record of owner whose id starts with
// prefix (used when an account is removed).
func (s *store) deleteOwnedWithPrefix(table string, owner string, idPrefix string) {
	defer logger.Out0(logger.In4("email", "store.deleteOwnedWithPrefix", "s", s, "table", table, "owner", owner, "idPrefix", idPrefix))
	entries, err := s.db.ListTable(table)
	if err != nil {
		logger.DebugErr("email", err)
		return
	}
	prefix := owner + "/" + idPrefix
	for _, entry := range entries {
		if len(entry) < 1 {
			continue
		}
		key := string(entry[0])
		if strings.HasPrefix(key, prefix) {
			s.db.Delete(table, key)
		}
	}
}
