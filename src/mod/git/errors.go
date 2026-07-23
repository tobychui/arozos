package git

/*
	errors.go

	Error vocabulary plus the classifier that decides whether a failed transport
	operation should make the front-end pop the credential dialog.

	go-git surfaces authentication problems through several unrelated error
	values depending on the transport and the server, so matching on the message
	is unavoidable. IsAuthError is kept as a pure, table-tested function.
*/

import (
	"errors"
	"strings"

	"github.com/go-git/go-git/v5/plumbing/transport"
)

var (
	//ErrNotARepo is returned when a path is not inside a git working tree.
	ErrNotARepo = errors.New("not a git repository")

	//ErrNoRemote is returned when an operation needs a remote but none is set.
	ErrNoRemote = errors.New("repository has no remote configured")

	//ErrUnbornBranch is returned when HEAD does not resolve yet (no commits).
	ErrUnbornBranch = errors.New("branch has no commits yet")

	//ErrAuthRequired is returned when the remote rejected or demanded
	//credentials. The AGI layer turns this into authRequired = true.
	ErrAuthRequired = errors.New("authentication required")
)

// authErrorFragments are lower-cased substrings that identify an authentication
// or authorisation failure across the git hosting services ArozOS users are
// likely to hit (GitHub, GitLab, Gitea, Bitbucket, plain http backends).
var authErrorFragments = []string{
	"authentication required",
	"authorization failed",
	"authentication failed",
	"invalid auth method",
	"unauthorized",
	"403 forbidden",
	"401 unauthorized",
	"bad credentials",
	"permission denied",
	"could not read username",
	"terminal prompts disabled",
	"support for password authentication was removed",
}

// IsAuthError reports whether err represents a credential problem rather than a
// genuine transport or repository failure.
func IsAuthError(err error) bool {
	if err == nil {
		return false
	}

	if errors.Is(err, ErrAuthRequired) ||
		errors.Is(err, transport.ErrAuthenticationRequired) ||
		errors.Is(err, transport.ErrAuthorizationFailed) {
		return true
	}

	message := strings.ToLower(err.Error())
	for _, fragment := range authErrorFragments {
		if strings.Contains(message, fragment) {
			return true
		}
	}
	return false
}

// classifyError normalises a go-git transport error so callers upstream can
// simply check errors.Is(err, ErrAuthRequired). The original message is kept as
// the wrapped text because it usually names the failing host.
func classifyError(err error) error {
	if err == nil {
		return nil
	}
	if IsAuthError(err) {
		return &authError{inner: err}
	}
	return err
}

// authError wraps a transport failure while reporting as ErrAuthRequired to
// errors.Is, so the AGI layer can set authRequired without losing the message.
type authError struct {
	inner error
}

func (e *authError) Error() string { return e.inner.Error() }

func (e *authError) Unwrap() error { return e.inner }

func (e *authError) Is(target error) bool { return target == ErrAuthRequired }
