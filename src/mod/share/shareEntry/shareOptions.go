package shareEntry

import (
	"errors"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

/*
	Share Options

	A ShareOption is one share link. A file or folder can carry any number of
	them (a public link, a password protected link, one per invited user or
	group ...), each with its own audience, access level, password and expiry.
*/

// Audiences of a share (stored in ShareOption.Permission for backward compatibility)
const (
	PermissionAnyone    = "anyone"    //Anyone who has the link
	PermissionSignedIn  = "signedin"  //Anyone signed in to this system
	PermissionSameGroup = "samegroup" //Users in all the owner's groups (snapshot in Accessibles)
	PermissionGroups    = "groups"    //Users in any of the groups listed in Accessibles
	PermissionUsers     = "users"     //Users listed in Accessibles (and the owner)
)

// Access levels of a share
const (
	AccessLevelView = "view" //Recipients can view (and download, if allowed)
	AccessLevelEdit = "edit" //Recipients can also upload into a shared folder
)

// currentSchemaVersion is bumped whenever ShareOption gains fields that need a
// default other than their zero value. See migrate().
const currentSchemaVersion = 2

// bcrypt refuses passwords longer than 72 bytes
const maxPasswordLength = 72

type ShareOption struct {
	UUID            string
	PathHash        string //Path Hash, the key for loading a share from vpath and fsh specific config
	FileVirtualPath string
	FileRealPath    string
	Owner           string
	Accessibles     []string //Use to store username or group names if permission is groups or users
	Permission      string   //Access permission, allow {anyone / signedin / samegroup / groups / users}
	IsFolder        bool

	//Schema version 2
	SchemaVersion int
	AccessLevel   string //{view / edit}, edit only takes effect on folders
	AllowDownload bool   //Recipients can download the file (or the folder as zip)
	ShowFileList  bool   //Recipients can browse the content of a shared folder
	PasswordHash  string //bcrypt hash of the share password, empty if not protected
	ExpireAt      int64  //Unix timestamp (seconds) this share expires at, 0 = never
	CreatedAt     int64  //Unix timestamp (seconds) this share is created at
}

// ShareSettings are the user editable options of a share. On update, nil
// fields are left unchanged.
type ShareSettings struct {
	Permission    *string
	Accessibles   []string //Only read when Permission is set
	AccessLevel   *string
	AllowDownload *bool
	ShowFileList  *bool
	Password      *string //Empty string removes the password
	ExpireAt      *int64  //0 removes the expiry
}

// DefaultShareOption returns a share with the default settings: anyone with
// the link can view and download it, forever.
func DefaultShareOption() *ShareOption {
	return &ShareOption{
		Accessibles:   []string{},
		Permission:    PermissionAnyone,
		SchemaVersion: currentSchemaVersion,
		AccessLevel:   AccessLevelView,
		AllowDownload: true,
		ShowFileList:  true,
		CreatedAt:     time.Now().Unix(),
	}
}

// migrate upgrades a share loaded from an older database record. It returns
// true if the record was changed and should be written back.
func (s *ShareOption) migrate() bool {
	if s.SchemaVersion >= currentSchemaVersion {
		return false
	}
	//Version 1 shares had no notion of these and behaved as below
	s.AccessLevel = AccessLevelView
	s.AllowDownload = true
	s.ShowFileList = true
	if s.Accessibles == nil {
		s.Accessibles = []string{}
	}
	s.SchemaVersion = currentSchemaVersion
	return true
}

// Clone returns a deep copy of this share, so callers can read it without
// racing against updates.
func (s *ShareOption) Clone() *ShareOption {
	c := *s
	c.Accessibles = append([]string{}, s.Accessibles...)
	return &c
}

func (s *ShareOption) IsOwnedBy(username string) bool {
	return s.Owner == username
}

func (s *ShareOption) IsAccessibleBy(username string, usergroup []string) bool {
	if s.Permission == PermissionAnyone || s.Permission == PermissionSignedIn {
		return true
	} else if s.Permission == PermissionSameGroup || s.Permission == PermissionGroups {
		for _, thisUserGroup := range usergroup {
			if stringInSlice(thisUserGroup, s.Accessibles) {
				//User's group is in the allowed group
				return true
			}
		}
	} else if s.Permission == PermissionUsers {
		if stringInSlice(username, s.Accessibles) {
			//User's name is in the allowed group
			return true
		} else if s.Owner == username {
			//This user own this file
			return true
		}
	}
	return false
}

// RequireLogin reports whether the recipient must be signed in to open this share
func (s *ShareOption) RequireLogin() bool {
	return s.Permission != PermissionAnyone
}

// IsExpired reports whether this share has an expiry and it has passed
func (s *ShareOption) IsExpired(now time.Time) bool {
	return s.ExpireAt > 0 && now.Unix() >= s.ExpireAt
}

// HasPassword reports whether this share is password protected
func (s *ShareOption) HasPassword() bool {
	return s.PasswordHash != ""
}

// CanUpload reports whether recipients may upload files into this share
func (s *ShareOption) CanUpload() bool {
	return s.IsFolder && s.AccessLevel == AccessLevelEdit
}

// SetPassword hashes and stores the given password. An empty password
// removes the protection.
func (s *ShareOption) SetPassword(password string) error {
	if password == "" {
		s.PasswordHash = ""
		return nil
	}
	if len(password) > maxPasswordLength {
		return errors.New("password too long")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	s.PasswordHash = string(hash)
	return nil
}

// CheckPassword reports whether the given password unlocks this share. A
// share without password accepts anything.
func (s *ShareOption) CheckPassword(password string) bool {
	if !s.HasPassword() {
		return true
	}
	return bcrypt.CompareHashAndPassword([]byte(s.PasswordHash), []byte(password)) == nil
}

// Apply validates the given settings and writes them into this share. The
// share is left untouched if any setting is invalid.
func (s *ShareOption) Apply(settings ShareSettings, now time.Time) error {
	next := s.Clone()
	if settings.Permission != nil {
		accessibles := cleanNameList(settings.Accessibles)
		switch *settings.Permission {
		case PermissionAnyone, PermissionSignedIn:
			accessibles = []string{}
		case PermissionSameGroup:
			//Accessibles holds the owner's groups, filled in by the caller
		case PermissionGroups, PermissionUsers:
			if len(accessibles) == 0 {
				return errors.New("select at least one " + strings.TrimSuffix(*settings.Permission, "s"))
			}
		default:
			return errors.New("invalid share permission")
		}
		next.Permission = *settings.Permission
		next.Accessibles = accessibles
	}

	if settings.AccessLevel != nil {
		switch *settings.AccessLevel {
		case AccessLevelView:
		case AccessLevelEdit:
			if !next.IsFolder {
				return errors.New("edit access is only available for folders")
			}
		default:
			return errors.New("invalid access level")
		}
		next.AccessLevel = *settings.AccessLevel
	}

	if settings.AllowDownload != nil {
		next.AllowDownload = *settings.AllowDownload
	}

	if settings.ShowFileList != nil {
		next.ShowFileList = *settings.ShowFileList
	}

	if settings.ExpireAt != nil {
		if *settings.ExpireAt < 0 {
			return errors.New("invalid expiry date")
		}
		if *settings.ExpireAt != 0 && *settings.ExpireAt <= now.Unix() {
			return errors.New("expiry date must be in the future")
		}
		next.ExpireAt = *settings.ExpireAt
	}

	if settings.Password != nil {
		if err := next.SetPassword(*settings.Password); err != nil {
			return err
		}
	}

	*s = *next
	return nil
}

// cleanNameList trims the given names and drops empty and duplicated ones
func cleanNameList(names []string) []string {
	results := []string{}
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name != "" && !stringInSlice(name, results) {
			results = append(results, name)
		}
	}
	return results
}
