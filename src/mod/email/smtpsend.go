package email

/*
	smtpsend.go

	Talking to SMTP submission servers.
*/

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/emersion/go-sasl"
	"github.com/emersion/go-smtp"

	"imuslab.com/arozos/mod/info/logger"
)

// dialSMTP connects to and authenticates with an account's SMTP server.
func (m *Manager) dialSMTP(ctx context.Context, p Principal, account *Account) (out0 *smtp.Client, out1 error) {
	defer logger.Out2(logger.In4("email", "Manager.dialSMTP", "m", m, "ctx", ctx, "&p", &p, "account", account), &out0, &out1)
	server := account.SMTP
	if server.Security == SecurityNone && !m.allowInsecure(p) {
		return nil, ErrInsecureBlocked
	}
	allowPrivate := m.allowPrivate(p)

	var client *smtp.Client
	switch server.Security {
	case SecuritySSL, "":
		conn, err := dialTLS(ctx, server.Host, server.Port, allowPrivate, "")
		if err != nil {
			logger.DebugErr("email", err)
			return nil, describeDialError("SMTP", server, err)
		}
		client = smtp.NewClient(conn)
	case SecuritySTARTTLS:
		conn, err := dialGuarded(ctx, server.Host, server.Port, allowPrivate)
		if err != nil {
			logger.DebugErr("email", err)
			return nil, describeDialError("SMTP", server, err)
		}
		client, err = smtp.NewClientStartTLS(conn, tlsConfigFor(server.Host, ""))
		if err != nil {
			logger.DebugErr("email", err)
			return nil, describeDialError("SMTP", server, describeTLSError(err))
		}
	case SecurityNone:
		conn, err := dialGuarded(ctx, server.Host, server.Port, allowPrivate)
		if err != nil {
			logger.DebugErr("email", err)
			return nil, describeDialError("SMTP", server, err)
		}
		client = smtp.NewClient(conn)
	default:
		return nil, fmt.Errorf("unknown connection security %q", server.Security)
	}
	client.CommandTimeout = 2 * time.Minute

	if err := client.Hello(ehloName(m.options.Hostname)); err != nil {
		logger.DebugErr("email", err)
		client.Close()
		return nil, describeDialError("SMTP", server, err)
	}

	if err := m.authenticateSMTP(ctx, client, account); err != nil {
		logger.DebugErr("email", err)
		client.Close()
		return nil, err
	}
	return client, nil
}

// ehloName picks the name announced in EHLO. Several providers reject a bare
// word, so anything that is not a dotted host name becomes an address literal.
func ehloName(hostname string) (out0 string) {
	defer logger.Out1(logger.In1("email", "ehloName", "hostname", hostname), &out0)
	hostname = strings.TrimSpace(strings.ToLower(hostname))
	if hostname != "" && strings.Contains(hostname, ".") && !strings.ContainsAny(hostname, " _/") {
		return hostname
	}
	return "[127.0.0.1]"
}

func (m *Manager) authenticateSMTP(ctx context.Context, client *smtp.Client, account *Account) (out0 error) {
	defer logger.Out1(logger.In4("email", "Manager.authenticateSMTP", "m", m, "ctx", ctx, "client", client, "account", account), &out0)
	username := account.SMTP.Username
	if username == "" {
		username = account.Email
	}

	var saslClient sasl.Client
	switch account.Auth {
	case AuthOAuth2:
		token, err := m.oauth.accessToken(ctx, account)
		if err != nil {
			logger.DebugErr("email", err)
			return err
		}
		saslClient = newXOAuth2Client(username, token)
	default:
		secret := account.SMTPSecret
		if secret == "" {
			secret = account.Secret
		}
		password, err := m.box.Open(secret)
		if err != nil {
			logger.DebugErr("email", err)
			return &AuthError{Server: "SMTP", Detail: err.Error()}
		}
		if password == "" {
			return nil //Relay without authentication (LAN servers)
		}
		if ok, _ := client.Extension("AUTH"); !ok {
			//The server offers no authentication at all; send unauthenticated
			return nil
		}
		if client.SupportsAuth(sasl.Plain) {
			saslClient = sasl.NewPlainClient("", username, password)
		} else if client.SupportsAuth(sasl.Login) {
			saslClient = sasl.NewLoginClient(username, password)
		} else {
			return errors.New("the SMTP server offers no supported password authentication")
		}
	}

	if err := client.Auth(saslClient); err != nil {
		logger.DebugErr("email", err)
		var smtpErr *smtp.SMTPError
		if errors.As(err, &smtpErr) && (smtpErr.Code == 535 || smtpErr.Code == 534 || smtpErr.Code == 530 || smtpErr.Code == 454) {
			hint := authHintFor(account.Provider)
			if account.Auth == AuthOAuth2 {
				hint = "Your sign-in has expired or was revoked. Reconnect the account to sign in again."
			}
			return &AuthError{Server: "SMTP", Detail: smtpErr.Message, Hint: hint}
		}
		if looksLikeAuthFailure(err.Error()) {
			return &AuthError{Server: "SMTP", Detail: err.Error(), Hint: authHintFor(account.Provider)}
		}
		return err
	}
	return nil
}

// checkSMTP verifies SMTP settings and credentials.
func (m *Manager) checkSMTP(ctx context.Context, p Principal, account *Account) (out0 error) {
	defer logger.Out1(logger.In4("email", "Manager.checkSMTP", "m", m, "ctx", ctx, "&p", &p, "account", account), &out0)
	client, err := m.dialSMTP(ctx, p, account)
	if err != nil {
		logger.DebugErr("email", err)
		return err
	}
	client.Quit()
	client.Close()
	return nil
}

// sendRaw delivers a rendered message.
func (m *Manager) sendRaw(ctx context.Context, p Principal, account *Account, from string, recipients []string, raw []byte) (out0 error) {
	defer logger.Out1(logger.In7("email", "Manager.sendRaw", "m", m, "ctx", ctx, "&p", &p, "account", account, "from", from, "recipients", recipients, "raw", raw), &out0)
	if len(recipients) == 0 {
		return errors.New("no recipients")
	}
	client, err := m.dialSMTP(ctx, p, account)
	if err != nil {
		logger.DebugErr("email", err)
		return err
	}
	defer client.Close()

	if max, ok := client.MaxMessageSize(); ok && max > 0 && len(raw) > max {
		return fmt.Errorf("%w: the server accepts at most %s and this message is %s", ErrTooLarge, humanSize(int64(max)), humanSize(int64(len(raw))))
	}

	if err := client.SendMail(from, recipients, bytes.NewReader(raw)); err != nil {
		logger.DebugErr("email", err)
		var smtpErr *smtp.SMTPError
		if errors.As(err, &smtpErr) {
			return fmt.Errorf("the mail server refused the message: %s (%d)", smtpErr.Message, smtpErr.Code)
		}
		return err
	}
	client.Quit()
	return nil
}
