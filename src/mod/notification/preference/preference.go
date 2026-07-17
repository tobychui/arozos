package preference

/*
	Notification User Preferences

	This package stores, per user, how they want to receive notifications:
	which delivery agents are enabled, the minimum priority they care about,
	and the per-user secrets needed by some agents (Telegram chat id, custom
	webhook target).

	Storage is delegated to a KVStore (satisfied by mod/database.Database) so
	the logic here stays unit-testable with an in-memory fake.
*/

import (
	"encoding/json"
	"errors"

	notification "imuslab.com/arozos/mod/notification"
	"imuslab.com/arozos/mod/notification/agents/webhookn"
)

// KVStore is the minimal key/value persistence surface required by the
// preference store. The ArozOS system database (mod/database.Database)
// satisfies this interface.
type KVStore interface {
	NewTable(tableName string) error
	Write(tableName string, key string, value interface{}) error
	Read(tableName string, key string, assignee interface{}) error
	KeyExists(tableName string, key string) bool
}

// UserPreference captures a single user's notification delivery settings.
type UserPreference struct {
	//EnabledAgents maps an agent name (e.g. "desktop", "telegram", "smtpn",
	//"webhook") to whether the user wants notifications delivered through it.
	EnabledAgents map[string]bool `json:"enabledAgents"`
	//MinPriority is the lowest priority the user wishes to receive
	//(notification.PriorityLow / Medium / High). Lower priority notifications
	//are dropped for this user.
	MinPriority int `json:"minPriority"`
	//TelegramChatID is the user's linked Telegram chat id (used by the
	//telegram agent).
	TelegramChatID string `json:"telegramChatID"`
	//Webhook is the user's custom HTML API target (used by the webhook agent).
	Webhook webhookn.Target `json:"webhook"`
}

// Store persists UserPreference values in a KVStore table.
type Store struct {
	db    KVStore
	table string
}

const defaultTableName = "notification"

// NewStore creates a preference store backed by the given KVStore, ensuring the
// backing table exists.
func NewStore(db KVStore) (*Store, error) {
	if db == nil {
		return nil, errors.New("nil KVStore provided")
	}
	if err := db.NewTable(defaultTableName); err != nil {
		return nil, err
	}
	return &Store{db: db, table: defaultTableName}, nil
}

// DefaultPreference returns the preference applied to users who have never
// customised their settings: the desktop channel on, everything else off, and
// the lowest priority threshold so nothing is silently dropped.
func DefaultPreference() UserPreference {
	return UserPreference{
		EnabledAgents: map[string]bool{
			"desktop": true,
		},
		MinPriority: notification.PriorityLow,
	}
}

func prefKey(username string) string {
	return "pref/" + username
}

// Get returns the stored preference for a user, or DefaultPreference when the
// user has none saved.
func (s *Store) Get(username string) UserPreference {
	if !s.db.KeyExists(s.table, prefKey(username)) {
		return DefaultPreference()
	}
	var raw string
	if err := s.db.Read(s.table, prefKey(username), &raw); err != nil || raw == "" {
		return DefaultPreference()
	}
	var pref UserPreference
	if err := json.Unmarshal([]byte(raw), &pref); err != nil {
		return DefaultPreference()
	}
	if pref.EnabledAgents == nil {
		pref.EnabledAgents = map[string]bool{}
	}
	if pref.MinPriority == 0 {
		pref.MinPriority = notification.PriorityLow
	}
	return pref
}

// Set persists the given preference for a user after normalising it.
func (s *Store) Set(username string, pref UserPreference) error {
	if username == "" {
		return errors.New("username cannot be empty")
	}
	pref.MinPriority = notification.NormalizePriority(pref.MinPriority)
	if pref.EnabledAgents == nil {
		pref.EnabledAgents = map[string]bool{}
	}
	js, err := json.Marshal(pref)
	if err != nil {
		return err
	}
	return s.db.Write(s.table, prefKey(username), string(js))
}

// TelegramChatIDResolver returns a resolver suitable for the telegram agent. It
// yields the user's linked chat id, or an error when none is set.
func (s *Store) TelegramChatIDResolver() func(string) (string, error) {
	return func(username string) (string, error) {
		pref := s.Get(username)
		if pref.TelegramChatID == "" {
			return "", errors.New("no Telegram chat id linked for user " + username)
		}
		return pref.TelegramChatID, nil
	}
}

// WebhookResolver returns a resolver suitable for the webhook agent. It yields
// the user's configured webhook target, or an error when none is set.
func (s *Store) WebhookResolver() func(string) (webhookn.Target, error) {
	return func(username string) (webhookn.Target, error) {
		pref := s.Get(username)
		if pref.Webhook.URL == "" {
			return webhookn.Target{}, errors.New("no webhook configured for user " + username)
		}
		return pref.Webhook, nil
	}
}

// ResolveAgents decides which of the registered consumer agents should receive
// a notification of the given priority for a user. requestedAgents, when
// non-empty, restricts delivery to the intersection of the user's enabled
// agents and the producer's requested channels. Returns nil when the
// notification should be dropped for this user (below their priority threshold
// or no enabled channel).
func (s *Store) ResolveAgents(username string, priority int, availableAgents []string, requestedAgents []string) []string {
	pref := s.Get(username)
	if notification.NormalizePriority(priority) < pref.MinPriority {
		return nil
	}

	resolved := []string{}
	for _, agentName := range availableAgents {
		if !pref.EnabledAgents[agentName] {
			continue
		}
		if len(requestedAgents) > 0 && !contains(requestedAgents, agentName) {
			continue
		}
		resolved = append(resolved, agentName)
	}
	if len(resolved) == 0 {
		return nil
	}
	return resolved
}

func contains(list []string, item string) bool {
	for _, v := range list {
		if v == item {
			return true
		}
	}
	return false
}
