package email

/*
	manager.go

	Manager is the single entry point of the mail backend. It owns the mail
	database, the secret box, the IMAP connection pool, pending OAuth sign-ins
	and the outbox that delivers delayed (undo-able) and scheduled mail.

	The package knows nothing about ArozOS virtual paths: the AGI library
	resolves paths, permissions and quota and hands this package plain bytes
	and readers.
*/

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/info/logger"
)

// Options configures a Manager.
type Options struct {
	//DataDir holds mail.db, secret.key and the outbox spool, e.g. ./system/mail
	DataDir string

	//Database overrides the bolt file opened under DataDir (tests).
	Database KVStore

	//HTTPClient is used for OAuth token requests and autoconfig lookups when
	//set (tests). Production uses guarded clients.
	HTTPClient *http.Client

	//Hostname is used in generated Message-IDs when the sender domain is unknown.
	Hostname string

	//Notify lets the outbox tell a user that a scheduled message failed.
	Notify func(username string, title string, message string)

	//DisableBackground stops the janitor / outbox goroutine (tests).
	DisableBackground bool
}

// Manager runs every mail operation.
type Manager struct {
	options  Options
	store    *store
	box      *secretBox
	ownedDB  *database.Database
	pool     *connPool
	oauth    *oauthManager
	previews *previewCache
	folders  folderCache
	outbox   *outbox

	stop     chan struct{}
	stopOnce sync.Once
	wg       sync.WaitGroup
}

// NewManager opens (or creates) the mail data folder and starts the
// background janitor.
func NewManager(options Options) (*Manager, error) {
	if strings.TrimSpace(options.DataDir) == "" {
		return nil, errors.New("mail data directory is required")
	}
	if err := os.MkdirAll(options.DataDir, 0700); err != nil {
		return nil, err
	}

	manager := &Manager{
		options:  options,
		pool:     newConnPool(),
		previews: newPreviewCache(4000),
		stop:     make(chan struct{}),
	}

	db := options.Database
	if db == nil {
		opened, err := database.NewDatabase(filepath.Join(options.DataDir, "mail.db"), false)
		if err != nil {
			return nil, err
		}
		manager.ownedDB = opened
		db = opened
	}

	st, err := newStore(db)
	if err != nil {
		manager.closeDB()
		return nil, err
	}
	manager.store = st

	box, err := loadSecretBox(options.DataDir)
	if err != nil {
		manager.closeDB()
		return nil, err
	}
	manager.box = box
	manager.oauth = newOAuthManager(manager)

	spool := filepath.Join(options.DataDir, "outbox")
	if err := os.MkdirAll(spool, 0700); err != nil {
		manager.closeDB()
		return nil, err
	}
	manager.outbox = newOutbox(manager, spool)

	if !options.DisableBackground {
		manager.wg.Add(1)
		go manager.backgroundLoop()
	}
	return manager, nil
}

// Close stops background work and releases connections and the database.
func (m *Manager) Close() {
	m.stopOnce.Do(func() {
		close(m.stop)
	})
	m.wg.Wait()
	m.pool.closeAll()
	m.closeDB()
}

func (m *Manager) closeDB() {
	if m.ownedDB != nil {
		m.ownedDB.Close()
		m.ownedDB = nil
	}
}

func (m *Manager) backgroundLoop() {
	defer m.wg.Done()
	janitor := time.NewTicker(time.Minute)
	outboxTicker := time.NewTicker(5 * time.Second)
	defer janitor.Stop()
	defer outboxTicker.Stop()

	for {
		select {
		case <-m.stop:
			return
		case <-janitor.C:
			m.pool.reap()
			m.oauth.cleanup()
		case <-outboxTicker.C:
			m.outbox.processDue(context.Background())
		}
	}
}

// AdminConfig returns the administrator configuration with secrets hidden.
func (m *Manager) AdminConfig() AdminConfigView {
	config := m.store.getAdminConfig()
	return AdminConfigView{
		Google:            config.Google.view(),
		Microsoft:         config.Microsoft.view(),
		AllowPrivateHosts: config.AllowPrivateHosts,
		AllowInsecure:     config.AllowInsecure,
		MaxAttachmentMB:   config.MaxAttachmentMB,
		MaxAccounts:       config.MaxAccounts,
	}
}

// AdminConfigInput is an update from the admin page. A client secret is only
// replaced when its *SecretSet flag is true (an empty secret then clears it),
// so saving the page without retyping the secret keeps the stored one.
type AdminConfigInput struct {
	Google             OAuthClient `json:"google"`
	Microsoft          OAuthClient `json:"microsoft"`
	GoogleSecretSet    bool        `json:"googleSecretSet"`
	MicrosoftSecretSet bool        `json:"microsoftSecretSet"`
	AllowPrivateHosts  bool        `json:"allowPrivateHosts"`
	AllowInsecure      bool        `json:"allowInsecure"`
	MaxAttachmentMB    int         `json:"maxAttachmentMB"`
	MaxAccounts        int         `json:"maxAccounts"`
}

// SetAdminConfig stores a new administrator configuration. Only admins may
// call it; the AGI layer enforces that and passes the principal along.
func (m *Manager) SetAdminConfig(p Principal, input AdminConfigInput) error {
	if !p.Admin {
		return errors.New("only administrators can change mail settings")
	}
	current := m.store.getAdminConfig()

	update := func(stored OAuthClient, incoming OAuthClient, secretSet bool) (OAuthClient, error) {
		result := incoming
		result.ClientSecret = stored.ClientSecret
		if secretSet {
			sealed, err := m.box.Seal(strings.TrimSpace(incoming.ClientSecret))
			if err != nil {
				return result, err
			}
			result.ClientSecret = sealed
		}
		return result, nil
	}

	google, err := update(current.Google, input.Google, input.GoogleSecretSet)
	if err != nil {
		return err
	}
	microsoft, err := update(current.Microsoft, input.Microsoft, input.MicrosoftSecretSet)
	if err != nil {
		return err
	}

	next := AdminConfig{
		Google:            google,
		Microsoft:         microsoft,
		AllowPrivateHosts: input.AllowPrivateHosts,
		AllowInsecure:     input.AllowInsecure,
		MaxAttachmentMB:   input.MaxAttachmentMB,
		MaxAccounts:       input.MaxAccounts,
	}
	if err := m.store.saveAdminConfig(next); err != nil {
		return err
	}
	m.oauth.resetTokenCache()
	logger.PrintAndLog("Email", "Mail administrator settings updated by "+p.Username, nil)
	return nil
}

// Settings returns a user's preferences.
func (m *Manager) Settings(p Principal) UserSettings {
	return m.store.getSettings(p.Username)
}

// SaveSettings replaces a user's preferences.
func (m *Manager) SaveSettings(p Principal, settings UserSettings) (UserSettings, error) {
	settings.normalise()
	if err := m.store.saveSettings(p.Username, settings); err != nil {
		return settings, err
	}
	return settings, nil
}

// TrustSender adds an address or domain to the remote-content allow list.
func (m *Manager) TrustSender(p Principal, sender string) error {
	sender = strings.ToLower(strings.TrimSpace(sender))
	if sender == "" {
		return errors.New("sender is empty")
	}
	m.store.mutex.Lock()
	defer m.store.mutex.Unlock()
	settings := m.store.getSettings(p.Username)
	if settings.IsTrustedSender(sender) {
		return nil
	}
	settings.TrustedSenders = append(settings.TrustedSenders, sender)
	return m.store.saveSettings(p.Username, settings)
}

// allowPrivate decides whether p may reach LAN / loopback servers.
func (m *Manager) allowPrivate(p Principal) bool {
	if p.Admin {
		return true
	}
	return m.store.getAdminConfig().AllowPrivateHosts
}

// allowInsecure decides whether p may use unencrypted connections.
func (m *Manager) allowInsecure(p Principal) bool {
	if p.Admin {
		return true
	}
	return m.store.getAdminConfig().AllowInsecure
}

// maxAttachmentBytes is the configured outgoing attachment budget.
func (m *Manager) maxAttachmentBytes() int64 {
	return int64(m.store.getAdminConfig().MaxAttachmentMB) * 1024 * 1024
}

func poolKey(owner string, accountID string) string {
	return owner + "/" + accountID
}

// withIMAP runs fn on a pooled, authenticated connection of an account.
func (m *Manager) withIMAP(ctx context.Context, p Principal, account *Account, fn func(c *imapclient.Client) error) error {
	key := poolKey(p.Username, account.ID)
	conn, err := m.pool.acquire(ctx, key, func() (*imapclient.Client, error) {
		return m.dialIMAP(ctx, p, account)
	})
	if err != nil {
		m.noteAuthError(p, account, err)
		return err
	}

	err = fn(conn.client)
	m.pool.release(key, conn, connectionBroken(conn.client, err))
	return err
}

// connectionBroken decides whether a connection may go back to the pool.
// Protocol-level "NO"/"BAD" answers and our own lookup errors leave it
// usable; network failures and closed connections do not.
func connectionBroken(client *imapclient.Client, err error) bool {
	if isClosed(client) {
		return true
	}
	if err == nil {
		return false
	}
	var statusErr *imap.Error
	if errors.As(err, &statusErr) {
		return false
	}
	var netErr net.Error
	if errors.As(err, &netErr) || errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	message := err.Error()
	return strings.Contains(message, "closed network connection") || strings.HasPrefix(message, "imapclient:") ||
		strings.Contains(message, "in imapwire")
}

// noteAuthError records (or clears) the authentication problem shown on an
// account in the sidebar.
func (m *Manager) noteAuthError(p Principal, account *Account, err error) {
	if !IsAuthError(err) {
		return
	}
	m.store.mutex.Lock()
	defer m.store.mutex.Unlock()
	stored, gerr := m.store.getAccount(p.Username, account.ID)
	if gerr != nil {
		return
	}
	stored.AuthError = err.Error()
	m.store.saveAccount(stored)
}

func (m *Manager) clearAuthError(p Principal, account *Account) {
	if account.AuthError == "" {
		return
	}
	m.store.mutex.Lock()
	defer m.store.mutex.Unlock()
	stored, err := m.store.getAccount(p.Username, account.ID)
	if err != nil {
		return
	}
	stored.AuthError = ""
	m.store.saveAccount(stored)
	account.AuthError = ""
}

func (m *Manager) now() time.Time {
	return time.Now()
}

// randomID returns n random bytes as hex.
func randomID(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format("150405.000000")))
	}
	return hex.EncodeToString(buf)
}
