package email

/*
	contacts.go

	A per-user address book. Addresses the user writes to are collected
	automatically (when enabled) and ranked by use, which is what makes
	recipient completion useful; entries can also be added and edited by hand.
*/

import (
	"errors"
	"net/mail"
	"sort"
	"strings"
)

// Contact is one address book entry.
type Contact struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Count    int    `json:"count"`
	LastUsed int64  `json:"lastUsed"`
	Manual   bool   `json:"manual"`
	Company  string `json:"company,omitempty"`
	Phone    string `json:"phone,omitempty"`
	Notes    string `json:"notes,omitempty"`
}

const maxContacts = 5000

func contactKey(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// Contacts lists the address book, most used first.
func (m *Manager) Contacts(p Principal) ([]Contact, error) {
	contacts, err := listOwned[Contact](m.store, tableContacts, p.Username)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(contacts, func(i, j int) bool {
		return strings.ToLower(displayName(contacts[i])) < strings.ToLower(displayName(contacts[j]))
	})
	return contacts, nil
}

func displayName(contact Contact) string {
	if contact.Name != "" {
		return contact.Name
	}
	return contact.Email
}

// SearchContacts returns completion candidates for a typed prefix.
func (m *Manager) SearchContacts(p Principal, query string, limit int) ([]Contact, error) {
	if limit <= 0 || limit > 50 {
		limit = 8
	}
	query = strings.ToLower(strings.TrimSpace(query))
	contacts, err := listOwned[Contact](m.store, tableContacts, p.Username)
	if err != nil {
		return nil, err
	}

	type scored struct {
		contact Contact
		score   int
	}
	matches := []scored{}
	for _, contact := range contacts {
		email := strings.ToLower(contact.Email)
		name := strings.ToLower(contact.Name)
		score := 0
		switch {
		case query == "":
			score = 1
		case strings.HasPrefix(email, query) || strings.HasPrefix(name, query):
			score = 3
		case wordPrefix(name, query):
			score = 2
		case strings.Contains(email, query) || strings.Contains(name, query):
			score = 1
		}
		if score == 0 {
			continue
		}
		matches = append(matches, scored{contact: contact, score: score})
	}
	sort.SliceStable(matches, func(i, j int) bool {
		a, b := matches[i], matches[j]
		if a.score != b.score {
			return a.score > b.score
		}
		if a.contact.Manual != b.contact.Manual {
			return a.contact.Manual
		}
		if a.contact.Count != b.contact.Count {
			return a.contact.Count > b.contact.Count
		}
		return a.contact.LastUsed > b.contact.LastUsed
	})
	results := []Contact{}
	for i := 0; i < len(matches) && i < limit; i++ {
		results = append(results, matches[i].contact)
	}
	return results, nil
}

func wordPrefix(text string, prefix string) bool {
	for _, word := range strings.Fields(text) {
		if strings.HasPrefix(word, prefix) {
			return true
		}
	}
	return false
}

// SaveContact creates or edits an entry by hand.
func (m *Manager) SaveContact(p Principal, contact Contact) (*Contact, error) {
	parsed, err := mail.ParseAddress(strings.TrimSpace(contact.Email))
	if err != nil {
		return nil, errors.New("please enter a valid email address")
	}
	contact.Email = parsed.Address
	contact.Name = strings.TrimSpace(contact.Name)
	if contact.Name == "" {
		contact.Name = parsed.Name
	}
	for _, field := range []*string{&contact.Company, &contact.Phone, &contact.Notes} {
		*field = strings.TrimSpace(*field)
		if len(*field) > 2000 {
			*field = (*field)[:2000]
		}
	}

	m.store.mutex.Lock()
	defer m.store.mutex.Unlock()
	key := ownerKey(p.Username, contactKey(contact.Email))
	existing := Contact{}
	if m.store.db.KeyExists(tableContacts, key) {
		m.store.db.Read(tableContacts, key, &existing)
	}
	contact.Count = existing.Count
	contact.LastUsed = existing.LastUsed
	contact.Manual = true
	if err := m.store.db.Write(tableContacts, key, contact); err != nil {
		return nil, err
	}
	return &contact, nil
}

// DeleteContact removes an entry.
func (m *Manager) DeleteContact(p Principal, email string) error {
	key := ownerKey(p.Username, contactKey(email))
	if !m.store.db.KeyExists(tableContacts, key) {
		return nil
	}
	return m.store.db.Delete(tableContacts, key)
}

// collectContacts records the recipients of a sent message.
func (m *Manager) collectContacts(p Principal, addresses []Address) {
	if len(addresses) == 0 {
		return
	}
	m.store.mutex.Lock()
	defer m.store.mutex.Unlock()

	now := m.now().Unix()
	existingCount := -1
	for _, address := range addresses {
		email := strings.TrimSpace(address.Email)
		if email == "" {
			continue
		}
		key := ownerKey(p.Username, contactKey(email))
		contact := Contact{}
		if m.store.db.KeyExists(tableContacts, key) {
			m.store.db.Read(tableContacts, key, &contact)
		} else {
			if existingCount < 0 {
				all, _ := listOwned[Contact](m.store, tableContacts, p.Username)
				existingCount = len(all)
			}
			if existingCount >= maxContacts {
				continue
			}
			existingCount++
			contact.Email = email
		}
		if contact.Name == "" && address.Name != "" {
			contact.Name = address.Name
		}
		contact.Count++
		contact.LastUsed = now
		m.store.db.Write(tableContacts, key, contact)
	}
}

// ImportContacts adds many entries at once (vCard / CSV import in the UI).
func (m *Manager) ImportContacts(p Principal, contacts []Contact) (int, error) {
	imported := 0
	for _, contact := range contacts {
		if _, err := m.SaveContact(p, contact); err == nil {
			imported++
		}
	}
	return imported, nil
}
