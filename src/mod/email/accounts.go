package email

/*
	accounts.go

	Adding, testing, updating and removing mail accounts. An account is only
	stored after its IMAP login (and, unless skipped, its SMTP login) worked,
	so the sidebar never fills up with half-configured accounts.
*/

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"sort"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

// accountColors cycle for new accounts (dot in the sidebar, avatar ring).
var accountColors = []string{"#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#64748b"}

// TestResult reports the outcome of a connection test.
type TestResult struct {
	IMAPOK     bool   `json:"imapOk"`
	SMTPOK     bool   `json:"smtpOk"`
	Error      string `json:"error,omitempty"`
	AuthFailed bool   `json:"authFailed"`
	Hint       string `json:"hint,omitempty"`
	Stage      string `json:"stage,omitempty"` //imap | smtp
}

func (a *Account) info() AccountInfo {
	return AccountInfo{
		ID:              a.ID,
		Email:           a.Email,
		DisplayName:     a.DisplayName,
		Provider:        a.Provider,
		Color:           a.Color,
		IMAP:            a.IMAP,
		SMTP:            a.SMTP,
		Auth:            a.Auth,
		OAuthProvider:   a.OAuthProvider,
		Signature:       a.Signature,
		ReplyTo:         a.ReplyTo,
		SaveSent:        a.SaveSent,
		Order:           a.Order,
		HasSecret:       a.Secret != "",
		SeparateSMTPKey: a.SMTPSecret != "",
		AuthError:       a.AuthError,
	}
}

// ListAccounts returns a user's accounts in sidebar order.
func (m *Manager) ListAccounts(p Principal) ([]AccountInfo, error) {
	accounts, err := m.store.listAccounts(p.Username)
	if err != nil {
		return nil, err
	}
	results := make([]AccountInfo, 0, len(accounts))
	for _, account := range accounts {
		results = append(results, account.info())
	}
	return results, nil
}

// account loads one of p's accounts.
func (m *Manager) account(p Principal, id string) (*Account, error) {
	return m.store.getAccount(p.Username, strings.TrimSpace(id))
}

// GetAccount returns the browser view of one account.
func (m *Manager) GetAccount(p Principal, id string) (*AccountInfo, error) {
	account, err := m.account(p, id)
	if err != nil {
		return nil, err
	}
	info := account.info()
	return &info, nil
}

// normaliseInput validates an account form and fills preset defaults.
func (m *Manager) normaliseInput(p Principal, input *AccountInput) error {
	input.Email = strings.TrimSpace(input.Email)
	parsed, err := mail.ParseAddress(input.Email)
	if err != nil || !strings.Contains(parsed.Address, "@") {
		return errors.New("please enter a valid email address")
	}
	input.Email = parsed.Address
	if input.DisplayName == "" && parsed.Name != "" {
		input.DisplayName = parsed.Name
	}
	input.DisplayName = strings.TrimSpace(input.DisplayName)

	preset, known := PresetByID(input.Provider)
	if !known {
		if detected, ok := presetForDomain(domainOf(input.Email)); ok {
			preset = detected
		} else {
			preset = customPreset
		}
		input.Provider = preset.ID
	}

	fill := func(server *ServerConfig, defaults ServerConfig, label string) error {
		server.Host = strings.ToLower(strings.TrimSpace(server.Host))
		if server.Host == "" {
			server.Host = defaults.Host
		}
		if server.Port == 0 {
			server.Port = defaults.Port
		}
		if server.Security == "" {
			server.Security = defaults.Security
		}
		server.Username = strings.TrimSpace(server.Username)
		if server.Username == "" {
			server.Username = usernameFor(preset.UsernameStyle, input.Email)
		}
		if server.Host == "" {
			return fmt.Errorf("%s server is required", label)
		}
		if strings.ContainsAny(server.Host, " /\\@") {
			return fmt.Errorf("%s server name is not valid", label)
		}
		if server.Port <= 0 || server.Port > 65535 {
			return fmt.Errorf("%s port is not valid", label)
		}
		if !oneOf(server.Security, SecuritySSL, SecuritySTARTTLS, SecurityNone) {
			return fmt.Errorf("%s security must be ssl, starttls or none", label)
		}
		if server.Security == SecurityNone && !m.allowInsecure(p) {
			return ErrInsecureBlocked
		}
		return nil
	}
	if err := fill(&input.IMAP, preset.IMAP, "IMAP"); err != nil {
		return err
	}
	if err := fill(&input.SMTP, preset.SMTP, "SMTP"); err != nil {
		return err
	}

	if input.Auth == "" {
		input.Auth = AuthPassword
	}
	if !oneOf(input.Auth, AuthPassword, AuthOAuth2) {
		return errors.New("unknown authentication method")
	}
	if !oneOf(input.SaveSent, "auto", "always", "never") {
		input.SaveSent = "auto"
	}
	input.ReplyTo = strings.TrimSpace(input.ReplyTo)
	if input.ReplyTo != "" {
		if _, err := mail.ParseAddress(input.ReplyTo); err != nil {
			return errors.New("the reply-to address is not valid")
		}
	}
	if len(input.Signature) > 256*1024 {
		return errors.New("the signature is too large")
	}
	return nil
}

// TestAccount checks the IMAP and SMTP settings without storing anything.
// Only password accounts can be tested this way; OAuth accounts are tested
// as part of AddAccount, where the pending token is consumed.
func (m *Manager) TestAccount(ctx context.Context, p Principal, input AccountInput) TestResult {
	if err := m.normaliseInput(p, &input); err != nil {
		return TestResult{Error: err.Error()}
	}
	if input.Auth == AuthOAuth2 {
		return TestResult{Error: "OAuth accounts are verified when they are added"}
	}
	account, err := m.accountFromInput(p, input, nil)
	if err != nil {
		return TestResult{Error: err.Error()}
	}
	return m.verifyAccount(ctx, p, account, input.SkipSMTPCheck)
}

// verifyAccount logs in to both servers of an unsaved account.
func (m *Manager) verifyAccount(ctx context.Context, p Principal, account *Account, skipSMTP bool) TestResult {
	result := TestResult{}
	client, err := m.dialIMAP(ctx, p, account)
	if err != nil {
		result.Stage = "imap"
		result.Error = err.Error()
		result.AuthFailed = IsAuthError(err)
		result.Hint = AuthHint(err)
		return result
	}
	logoutAndClose(client)
	result.IMAPOK = true

	if skipSMTP {
		return result
	}
	if err := m.checkSMTP(ctx, p, account); err != nil {
		result.Stage = "smtp"
		result.Error = err.Error()
		result.AuthFailed = IsAuthError(err)
		result.Hint = AuthHint(err)
		return result
	}
	result.SMTPOK = true
	return result
}

// accountFromInput builds an Account (with sealed secrets) from a form.
// existing supplies kept secrets on update.
func (m *Manager) accountFromInput(p Principal, input AccountInput, existing *Account) (*Account, error) {
	account := &Account{
		Owner:       p.Username,
		Email:       input.Email,
		DisplayName: input.DisplayName,
		Provider:    input.Provider,
		Color:       input.Color,
		IMAP:        input.IMAP,
		SMTP:        input.SMTP,
		Auth:        input.Auth,
		Signature:   input.Signature,
		ReplyTo:     input.ReplyTo,
		SaveSent:    input.SaveSent,
	}
	if existing != nil {
		account.ID = existing.ID
		account.Order = existing.Order
		account.Created = existing.Created
		account.OAuthProvider = existing.OAuthProvider
		account.OAuthFlow = existing.OAuthFlow
		if account.Color == "" {
			account.Color = existing.Color
		}
	}

	switch input.Auth {
	case AuthPassword:
		account.OAuthProvider = ""
		account.OAuthFlow = ""
		if input.Password != "" {
			sealed, err := m.box.Seal(input.Password)
			if err != nil {
				return nil, err
			}
			account.Secret = sealed
		} else if existing != nil && existing.Auth == AuthPassword {
			account.Secret = existing.Secret
		} else {
			return nil, errors.New("please enter the password")
		}
		if input.SMTPPassword != "" {
			sealed, err := m.box.Seal(input.SMTPPassword)
			if err != nil {
				return nil, err
			}
			account.SMTPSecret = sealed
		} else if existing != nil && existing.Auth == AuthPassword {
			account.SMTPSecret = existing.SMTPSecret
		}
	case AuthOAuth2:
		if input.OAuthState != "" {
			pending, err := m.oauth.take(input.OAuthState, p.Username)
			if err != nil {
				return nil, err
			}
			if pending.token.RefreshToken == "" {
				return nil, errors.New("the provider did not grant offline access, please sign in again and accept all permissions")
			}
			sealed, err := m.box.Seal(pending.token.RefreshToken)
			if err != nil {
				return nil, err
			}
			account.Secret = sealed
			account.OAuthProvider = pending.provider
			account.OAuthFlow = pending.flow
			account.freshAccessToken = pending.token.AccessToken
			if !pending.token.Expiry.IsZero() {
				account.freshTokenExpiry = pending.token.Expiry.Unix()
			}
			if pending.idEmail != "" && !strings.EqualFold(pending.idEmail, account.Email) {
				//The mailbox is whatever the user actually signed in to
				account.Email = pending.idEmail
				if strings.EqualFold(account.IMAP.Username, input.Email) {
					account.IMAP.Username = pending.idEmail
				}
				if strings.EqualFold(account.SMTP.Username, input.Email) {
					account.SMTP.Username = pending.idEmail
				}
			}
		} else if existing != nil && existing.Auth == AuthOAuth2 {
			account.Secret = existing.Secret
		} else {
			return nil, errors.New("please sign in with your provider first")
		}
		account.SMTPSecret = ""
	}
	return account, nil
}

// AddAccount verifies and stores a new account.
func (m *Manager) AddAccount(ctx context.Context, p Principal, input AccountInput) (*AccountInfo, TestResult, error) {
	if err := m.normaliseInput(p, &input); err != nil {
		return nil, TestResult{Error: err.Error()}, err
	}

	existing, err := m.store.listAccounts(p.Username)
	if err != nil {
		return nil, TestResult{}, err
	}
	config := m.store.getAdminConfig()
	if config.MaxAccounts > 0 && len(existing) >= config.MaxAccounts {
		err := fmt.Errorf("you can add at most %d mail accounts", config.MaxAccounts)
		return nil, TestResult{Error: err.Error()}, err
	}

	account, err := m.accountFromInput(p, input, nil)
	if err != nil {
		return nil, TestResult{Error: err.Error()}, err
	}
	for _, other := range existing {
		if strings.EqualFold(other.Email, account.Email) && strings.EqualFold(other.IMAP.Host, account.IMAP.Host) {
			err := errors.New(account.Email + " is already added")
			return nil, TestResult{Error: err.Error()}, err
		}
	}

	account.ID = randomID(8)
	account.Created = m.now().Unix()
	account.Updated = account.Created
	maxOrder := -1
	for _, other := range existing {
		if other.Order > maxOrder {
			maxOrder = other.Order
		}
	}
	account.Order = maxOrder + 1
	if account.Color == "" {
		account.Color = accountColors[len(existing)%len(accountColors)]
	}

	m.oauth.seed(account)
	result := m.verifyAccount(ctx, p, account, input.SkipSMTPCheck)
	if result.Error != "" {
		m.oauth.forget(account)
		return nil, result, errors.New(result.Error)
	}

	if err := m.store.saveAccount(account); err != nil {
		return nil, result, err
	}
	logger.PrintAndLog("Email", "Mail account "+account.Email+" added by "+p.Username, nil)
	info := account.info()
	return &info, result, nil
}

// UpdateAccount changes an account. Connection settings and credentials are
// re-verified before anything is stored.
func (m *Manager) UpdateAccount(ctx context.Context, p Principal, id string, input AccountInput) (*AccountInfo, TestResult, error) {
	existing, err := m.account(p, id)
	if err != nil {
		return nil, TestResult{Error: err.Error()}, err
	}
	if err := m.normaliseInput(p, &input); err != nil {
		return nil, TestResult{Error: err.Error()}, err
	}

	account, err := m.accountFromInput(p, input, existing)
	if err != nil {
		return nil, TestResult{Error: err.Error()}, err
	}

	connectionChanged := account.IMAP != existing.IMAP || account.SMTP != existing.SMTP ||
		account.Auth != existing.Auth || account.Secret != existing.Secret ||
		account.SMTPSecret != existing.SMTPSecret || !strings.EqualFold(account.Email, existing.Email)

	result := TestResult{IMAPOK: true, SMTPOK: true}
	if connectionChanged {
		m.oauth.forget(account)
		m.oauth.seed(account)
		result = m.verifyAccount(ctx, p, account, input.SkipSMTPCheck)
		if result.Error != "" {
			return nil, result, errors.New(result.Error)
		}
		account.AuthError = ""
	} else {
		account.AuthError = existing.AuthError
	}

	account.Updated = m.now().Unix()
	if err := m.store.saveAccount(account); err != nil {
		return nil, result, err
	}
	if connectionChanged {
		m.pool.invalidate(poolKey(p.Username, account.ID))
	}
	info := account.info()
	return &info, result, nil
}

// RemoveAccount deletes an account and everything stored locally for it.
func (m *Manager) RemoveAccount(p Principal, id string) error {
	account, err := m.account(p, id)
	if err != nil {
		return err
	}
	if err := m.store.deleteAccount(p.Username, account.ID); err != nil {
		return err
	}
	m.pool.invalidate(poolKey(p.Username, account.ID))
	m.oauth.forget(account)
	m.previews.dropAccount(p.Username, account.ID)
	prefix := account.ID + ":"
	m.store.deleteOwnedWithPrefix(tableSnooze, p.Username, prefix)
	m.store.deleteOwnedWithPrefix(tableLabelMap, p.Username, prefix)
	m.outbox.dropAccount(p.Username, account.ID)
	logger.PrintAndLog("Email", "Mail account "+account.Email+" removed by "+p.Username, nil)
	return nil
}

// ReorderAccounts stores a new sidebar order.
func (m *Manager) ReorderAccounts(p Principal, ids []string) error {
	accounts, err := m.store.listAccounts(p.Username)
	if err != nil {
		return err
	}
	position := map[string]int{}
	for index, id := range ids {
		position[id] = index
	}
	sort.SliceStable(accounts, func(i, j int) bool {
		pi, iok := position[accounts[i].ID]
		pj, jok := position[accounts[j].ID]
		if iok && jok {
			return pi < pj
		}
		return iok && !jok
	})
	for index, account := range accounts {
		if account.Order != index {
			account.Order = index
			if err := m.store.saveAccount(account); err != nil {
				return err
			}
		}
	}
	return nil
}
