package preference

/*
	Notification User Preferences

	This package stores, per user, how they want to receive notifications: a
	delivery matrix mapping each agent (channel) to the set of priorities the
	user wants to receive through it, plus the per-user secrets needed by some
	agents (Telegram chat id, custom webhook target).

	The matrix lets a user say, for example, "email only for high priority,
	desktop for everything, Telegram for medium and high".

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
	//Channels is the delivery matrix: agent name (e.g. "desktop", "telegram",
	//"smtpn", "webhook") -> priority label ("low" / "medium" / "high") ->
	//whether the user wants that agent to deliver notifications of that
	//priority.
	Channels map[string]map[string]bool `json:"channels"`
	//TelegramChatID is the user's linked Telegram chat id (used by the
	//telegram agent).
	TelegramChatID string `json:"telegramChatID"`
	//Webhook is the user's custom HTML API target (used by the webhook agent).
	Webhook webhookn.Target `json:"webhook"`
}

// priorityLabels are the valid columns of the delivery matrix.
var priorityLabels = []string{"low", "medium", "high"}

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
// customised their settings: the desktop channel on for every priority so
// nothing is silently dropped, and all other channels off.
func DefaultPreference() UserPreference {
	return UserPreference{
		Channels: map[string]map[string]bool{
			"desktop": {"low": true, "medium": true, "high": true},
		},
	}
}

func prefKey(username string) string {
	return "pref/" + username
}

// normalizeChannels ensures the matrix is non-nil and only contains valid
// priority labels.
func normalizeChannels(channels map[string]map[string]bool) map[string]map[string]bool {
	normalized := map[string]map[string]bool{}
	for agent, priorities := range channels {
		if priorities == nil {
			continue
		}
		row := map[string]bool{}
		for _, label := range priorityLabels {
			if priorities[label] {
				row[label] = true
			}
		}
		if len(row) > 0 {
			normalized[agent] = row
		}
	}
	return normalized
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
	pref.Channels = normalizeChannels(pref.Channels)
	return pref
}

// Set persists the given preference for a user after normalising it.
func (s *Store) Set(username string, pref UserPreference) error {
	if username == "" {
		return errors.New("username cannot be empty")
	}
	pref.Channels = normalizeChannels(pref.Channels)
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
// a notification of the given priority for a user, based on the user's delivery
// matrix. requestedAgents, when non-empty, further restricts delivery to the
// intersection with the producer's requested channels. Returns nil when no
// channel is enabled for this user at this priority.
func (s *Store) ResolveAgents(username string, priority int, availableAgents []string, requestedAgents []string) []string {
	pref := s.Get(username)
	label := notification.PriorityToString(notification.NormalizePriority(priority))

	resolved := []string{}
	for _, agentName := range availableAgents {
		row := pref.Channels[agentName]
		if row == nil || !row[label] {
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
