package auth

/*
	Forward authentication hook and account primitives

	A ForwardAuthHandler lets another subsystem (the cluster identity
	service) decide a login before the local password table is consulted.
	It receives the SHA-512 password hash, never the clear text, so it can be
	compared against the hashes stored on a remote node without shipping the
	password around.

	The account primitives below expose the auth table in terms of hashes and
	group lists so accounts can be replicated between nodes as-is.
*/

import (
	"crypto/subtle"
	"errors"
)

// ForwardAuthResult is the verdict of a ForwardAuthHandler.
type ForwardAuthResult struct {
	Decided  bool   //false means "no opinion", fall back to the local password table
	Accepted bool   //valid only when Decided
	Reason   string //shown to the user when Decided and not Accepted
}

// ForwardAuthHandler decides a login attempt from the username and the
// SHA-512 hash of the supplied password.
type ForwardAuthHandler func(username string, passwordHash string) ForwardAuthResult

// ValidateUsernameAndPasswordHash checks an already hashed password.
func (a *AuthAgent) ValidateUsernameAndPasswordHash(username string, passwordHash string) bool {
	stored, err := a.GetPasswordHash(username)
	if err != nil || stored == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(stored), []byte(passwordHash)) == 1
}

// GetPasswordHash returns the stored password hash of a user.
func (a *AuthAgent) GetPasswordHash(username string) (string, error) {
	hash := ""
	if err := a.Database.Read("auth", "passhash/"+username, &hash); err != nil {
		return "", err
	}
	if hash == "" {
		return "", errors.New("user not found")
	}
	return hash, nil
}

// SetPasswordHash stores an already hashed password for a user, creating the
// password entry when it does not exist yet.
func (a *AuthAgent) SetPasswordHash(username string, passwordHash string) error {
	if username == "" || passwordHash == "" {
		return errors.New("username and password hash are required")
	}
	return a.Database.Write("auth", "passhash/"+username, passwordHash)
}

// GetUserGroups returns the permission group names of a user.
func (a *AuthAgent) GetUserGroups(username string) ([]string, error) {
	if !a.Database.KeyExists("auth", "group/"+username) {
		return nil, errors.New("user not found")
	}
	groups := []string{}
	if err := a.Database.Read("auth", "group/"+username, &groups); err != nil {
		return nil, err
	}
	if groups == nil {
		groups = []string{}
	}
	return groups, nil
}

// SetUserGroups replaces the permission group names of a user.
func (a *AuthAgent) SetUserGroups(username string, groups []string) error {
	if username == "" {
		return errors.New("username is required")
	}
	if groups == nil {
		groups = []string{}
	}
	return a.Database.Write("auth", "group/"+username, groups)
}

// validateLogin decides a login, consulting the forward auth hook first.
func (a *AuthAgent) validateLogin(username string, password string) (bool, string) {
	if a.ForwardAuth != nil {
		if res := a.ForwardAuth(username, Hash(password)); res.Decided {
			return res.Accepted, res.Reason
		}
	}
	return a.ValidateUsernameAndPasswordWithReason(username, password)
}
