package auth

import (
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

/*
	Username rules

	A username names the user's home folder (files/users/<name>), appears in
	virtual paths, share links and the logins of the file servers. Every new
	account therefore gets a name that is safe as a folder name on Linux,
	macOS and Windows: letters and digits of any script, plus . - _ and @
	after the first character. Path separators, spaces, "..", control
	characters and the device names Windows reserves are refused.

	Only new accounts are checked (CreateUserAccount), so existing users with
	older names keep signing in.
*/

// MaxUsernameLength is the longest username, in characters
const MaxUsernameLength = 64

// windowsDeviceNames cannot be used as a file or folder name on Windows, not
// even with an extension (con.txt)
var windowsDeviceNames = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true, "COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true, "LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

// ValidateUsername reports why a name cannot be used for a new account
func ValidateUsername(name string) error {
	if name == "" {
		return errors.New("Username cannot be empty")
	}
	if !utf8.ValidString(name) {
		return errors.New("Username is not valid text")
	}
	if utf8.RuneCountInString(name) > MaxUsernameLength {
		return fmt.Errorf("Username is too long (at most %d characters)", MaxUsernameLength)
	}
	for i, r := range name {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			continue
		}
		if i == 0 {
			return errors.New("A username must start with a letter or a number")
		}
		switch {
		case r == '.' || r == '-' || r == '_' || r == '@':
			continue
		case unicode.IsMark(r):
			//Combining marks of scripts such as Devanagari or Thai
			continue
		case unicode.IsControl(r):
			return errors.New("A username cannot contain control or invisible characters")
		case unicode.IsSpace(r):
			return errors.New("A username cannot contain spaces")
		case unicode.IsPrint(r):
			return fmt.Errorf("A username cannot contain %q", string(r))
		}
		return errors.New("A username cannot contain control or invisible characters")
	}
	if strings.Contains(name, "..") {
		return errors.New("A username cannot contain \"..\"")
	}
	base := strings.ToUpper(strings.SplitN(name, ".", 2)[0])
	if windowsDeviceNames[base] {
		return errors.New(name + " is reserved by Windows and cannot be used as a username")
	}
	return nil
}
