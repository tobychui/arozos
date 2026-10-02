package email

/*
	imapconn.go

	Opening and authenticating IMAP connections.
*/

import (
	"context"
	"errors"
	"fmt"
	"mime"
	"net"
	"strings"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
	"github.com/emersion/go-message/charset"
	"github.com/emersion/go-sasl"
)

// wordDecoder decodes RFC 2047 encoded words in any charset go-message knows
// (GB2312, Big5, Shift_JIS, KOI8-R, …) so subjects and names in ENVELOPE
// responses arrive as proper UTF-8.
var wordDecoder = &mime.WordDecoder{CharsetReader: charset.Reader}

// dialIMAP connects, authenticates and identifies a client for an account.
func (m *Manager) dialIMAP(ctx context.Context, p Principal, account *Account) (*imapclient.Client, error) {
	server := account.IMAP
	if server.Security == SecurityNone && !m.allowInsecure(p) {
		return nil, ErrInsecureBlocked
	}

	client, err := connectIMAP(ctx, server, m.allowPrivate(p))
	if err != nil {
		return nil, err
	}

	if err := m.authenticateIMAP(ctx, client, account); err != nil {
		client.Close()
		return nil, err
	}

	//Some providers (NetEase 163/126) refuse SELECT from clients that did not
	//identify themselves. ID is harmless everywhere else.
	if client.Caps().Has(imap.CapID) {
		client.ID(&imap.IDData{Name: "ArozOS Mail", Version: "1.0", Vendor: "ArozOS"}).Wait()
	}
	return client, nil
}

// connectIMAP opens the transport and waits for the greeting.
func connectIMAP(ctx context.Context, server ServerConfig, allowPrivate bool) (*imapclient.Client, error) {
	options := &imapclient.Options{WordDecoder: wordDecoder}

	var client *imapclient.Client
	switch server.Security {
	case SecuritySSL, "":
		conn, err := dialTLS(ctx, server.Host, server.Port, allowPrivate, "imap")
		if err != nil {
			return nil, describeDialError("IMAP", server, err)
		}
		client = imapclient.New(conn, options)
	case SecuritySTARTTLS:
		conn, err := dialGuarded(ctx, server.Host, server.Port, allowPrivate)
		if err != nil {
			return nil, describeDialError("IMAP", server, err)
		}
		options.TLSConfig = tlsConfigFor(server.Host, "")
		client, err = imapclient.NewStartTLS(conn, options)
		if err != nil {
			return nil, describeDialError("IMAP", server, describeTLSError(err))
		}
	case SecurityNone:
		conn, err := dialGuarded(ctx, server.Host, server.Port, allowPrivate)
		if err != nil {
			return nil, describeDialError("IMAP", server, err)
		}
		client = imapclient.New(conn, options)
	default:
		return nil, fmt.Errorf("unknown connection security %q", server.Security)
	}

	if err := client.WaitGreeting(); err != nil {
		client.Close()
		return nil, describeDialError("IMAP", server, err)
	}
	return client, nil
}

// authenticateIMAP signs in with a password or an OAuth access token.
func (m *Manager) authenticateIMAP(ctx context.Context, client *imapclient.Client, account *Account) error {
	username := account.IMAP.Username
	if username == "" {
		username = account.Email
	}

	var err error
	switch account.Auth {
	case AuthOAuth2:
		var token string
		token, err = m.oauth.accessToken(ctx, account)
		if err != nil {
			return err
		}
		err = client.Authenticate(newXOAuth2Client(username, token))
	default:
		var password string
		password, err = m.box.Open(account.Secret)
		if err != nil {
			return &AuthError{Server: "IMAP", Detail: err.Error()}
		}
		caps := client.Caps()
		if caps.Has(imap.CapLoginDisabled) && caps.Has(imap.AuthCap(sasl.Plain)) {
			err = client.Authenticate(sasl.NewPlainClient("", username, password))
		} else {
			err = client.Login(username, password).Wait()
		}
	}

	if err != nil {
		return classifyLoginError("IMAP", account, err)
	}
	return nil
}

// classifyLoginError marks credential rejections as AuthError with a hint.
func classifyLoginError(server string, account *Account, err error) error {
	var statusErr *imap.Error
	isAuth := false
	detail := err.Error()
	if errors.As(err, &statusErr) {
		detail = statusErr.Text
		switch statusErr.Code {
		case imap.ResponseCodeAuthenticationFailed, imap.ResponseCodeAuthorizationFailed,
			imap.ResponseCodeExpired, imap.ResponseCodeContactAdmin, imap.ResponseCodePrivacyRequired:
			isAuth = true
		}
		transient := statusErr.Code == imap.ResponseCodeUnavailable || statusErr.Code == imap.ResponseCodeServerBug ||
			statusErr.Code == imap.ResponseCodeLimit || statusErr.Code == imap.ResponseCodeInUse
		if statusErr.Type == imap.StatusResponseTypeNo && !isAuth && !transient {
			//A NO to LOGIN / AUTHENTICATE is a rejection whatever the wording
			isAuth = true
		}
	}
	if !isAuth && looksLikeAuthFailure(detail) {
		isAuth = true
	}
	if !isAuth {
		return err
	}

	hint := ""
	if account.Auth == AuthOAuth2 {
		hint = "Your sign-in has expired or was revoked. Reconnect the account to sign in again."
	} else {
		hint = authHintFor(account.Provider)
		if hint == "" {
			hint = authHintFor(providerForServer(account.IMAP.Host))
		}
	}
	return &AuthError{Server: server, Detail: strings.TrimSpace(detail), Hint: hint}
}

// providerForServer recognises a preset from a server host name, so hints
// also work for accounts created as "custom" with known servers.
func providerForServer(host string) string {
	host = strings.ToLower(host)
	for _, preset := range presets {
		if host == preset.IMAP.Host || host == preset.SMTP.Host {
			return preset.ID
		}
	}
	return ""
}

// describeDialError adds the server to connection failures.
func describeDialError(protocol string, server ServerConfig, err error) error {
	if errors.Is(err, ErrBlockedAddress) {
		return err
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return fmt.Errorf("%s server %s could not be found", protocol, server.Host)
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) && opErr.Op == "dial" {
		return fmt.Errorf("cannot connect to %s server %s:%d (%v)", protocol, server.Host, server.Port, opErr.Err)
	}
	return fmt.Errorf("%s %s:%d: %w", protocol, server.Host, server.Port, err)
}
