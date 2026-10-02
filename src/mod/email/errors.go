package email

/*
	errors.go

	Sentinel errors the AGI layer maps onto flags the Mail front-end acts on
	(authFailed opens the sign-in dialog, blocked explains the admin policy).
*/

import (
	"errors"
	"strings"
)

var (
	ErrAccountNotFound = errors.New("mail account not found")
	ErrAuthFailed      = errors.New("authentication failed")
	ErrBlockedAddress  = errors.New("connections to local network addresses are disabled by the administrator")
	ErrInsecureBlocked = errors.New("unencrypted mail connections are disabled by the administrator")
	ErrFolderNotFound  = errors.New("folder not found")
	ErrMessageNotFound = errors.New("message not found, it may have been moved or deleted")
	ErrTooLarge        = errors.New("message is larger than the allowed size")
	ErrOAuthDisabled   = errors.New("this sign-in method has not been configured by the administrator")
)

// AuthError wraps a server's rejection of our credentials. Hint carries a
// provider specific suggestion (e.g. "use an app password").
type AuthError struct {
	Server string
	Detail string
	Hint   string
}

func (e *AuthError) Error() string {
	message := "authentication failed"
	if e.Server != "" {
		message = e.Server + " " + message
	}
	if e.Detail != "" {
		message += ": " + e.Detail
	}
	return message
}

func (e *AuthError) Unwrap() error {
	return ErrAuthFailed
}

// IsAuthError reports whether err means the stored credential is wrong or
// expired, so the UI should ask the user to sign in again.
func IsAuthError(err error) bool {
	return errors.Is(err, ErrAuthFailed)
}

// AuthHint returns the provider hint carried by an authentication error.
func AuthHint(err error) string {
	var authErr *AuthError
	if errors.As(err, &authErr) {
		return authErr.Hint
	}
	return ""
}

// looksLikeAuthFailure recognises the many ways servers word a rejected login
// when they do not use the AUTHENTICATIONFAILED response code.
func looksLikeAuthFailure(message string) bool {
	lower := strings.ToLower(message)
	for _, marker := range []string{
		"authenticationfailed", "authentication failed", "invalid credentials",
		"login failed", "logon failure", "authenticate failed", "auth failed",
		"username and password not accepted", "incorrect password",
		"invalid user", "authorizationfailed", "535", "534",
		"application-specific password required", "web login required",
		"unsafe login", "not authorized", "invalid login",
	} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}
