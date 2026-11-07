package access

/*
	Drive access lists

	Who may use a drive is decided by one list per drive: a row per permission
	group, plus a default access level for the users no row matches. The pool
	a drive is configured in stays its home, and the members of that group
	always have full access to it.

	This replaces both the per pool "other permission" (now the default access
	level, per drive) and bridging a drive into another pool (now a group row).
	The rules are kept by Store, except for cluster:/ whose rule is replicated
	with the cluster metadata, so that every member serves the same answer.
*/

import (
	"errors"
	"sort"
)

// The levels a drive can be used at, from low to high. These are the values of
// arozfs.FsDenied, FsReadOnly and FsReadWrite, which are variables and so
// cannot define a constant.
const (
	None      = "denied"
	Read      = "readonly"
	ReadWrite = "readwrite"
)

// IDs of the drives the system itself provides
const (
	UserDriveID    = "user"
	TmpDriveID     = "tmp"
	ShareDriveID   = "share"
	ClusterDriveID = "cluster"
)

// Why a user got the level they got, see Explain
const (
	ReasonFixed = "fixed" //user:/ and tmp:/ are open to everyone
	ReasonHome  = "home"  //The user is in the drive's home group
	ReasonAdmin = "admin" //Admins keep access to every drive of the system pool
	ReasonGroup = "group" //A row of one of the user's groups
	ReasonOther = "other" //No row matched, the default access applied
)

// Rule is the access list of one drive
type Rule struct {
	Other  string            `json:"other"`            //Level of the users no group row matches
	Groups map[string]string `json:"groups,omitempty"` //Level per permission group
}

// Source tells which rule a drive has. ok is false for a drive nobody changed,
// which then gets DefaultRule.
type Source interface {
	Rule(uuid string) (rule Rule, ok bool)
}

// Drive is the drive a level is worked out for
type Drive struct {
	UUID      string
	HomeGroup string //Permission group whose pool holds the drive, empty for the system pool
	ReadOnly  bool   //The whole drive is read only, whatever the rule says
}

// Subject is the user a level is worked out for
type Subject struct {
	Groups  []string //Names of the permission groups the user is in
	IsAdmin bool     //One of those groups is an admin group
}

// Decision is the result of Explain
type Decision struct {
	Level  string `json:"level"`           //The level the user ends up with
	Reason string `json:"reason"`          //One of the Reason constants
	Group  string `json:"group,omitempty"` //The group behind ReasonHome and ReasonGroup
	Capped bool   `json:"capped"`          //The drive is read only, so the level is lower than the rule gave
}

// IsFixed reports whether a drive is open to every user, with no rule
func IsFixed(uuid string) bool {
	return uuid == UserDriveID || uuid == TmpDriveID
}

// IsBuiltin reports whether a drive is provided by the system rather than
// configured by an admin. Built-in drives have no config row and cannot be
// edited, stopped or removed.
func IsBuiltin(uuid string) bool {
	return IsFixed(uuid) || uuid == ShareDriveID || uuid == ClusterDriveID
}

// DefaultRule is the rule of a drive nobody changed: what the system pool
// and the group pools gave their users before access lists existed.
func DefaultRule(uuid string, homeGroup string) Rule {
	switch {
	case uuid == ShareDriveID:
		return Rule{Other: Read}
	case homeGroup == "":
		return Rule{Other: ReadWrite}
	default:
		return Rule{Other: None}
	}
}

// IsLevel reports whether a value is a level a rule may hold
func IsLevel(level string) bool {
	return level == None || level == Read || level == ReadWrite
}

// rank orders the levels. Anything that is not a level ranks as None, so a
// damaged rule can only take access away.
func rank(level string) int {
	switch level {
	case ReadWrite:
		return 2
	case Read:
		return 1
	default:
		return 0
	}
}

// Higher returns the higher of two levels
func Higher(a string, b string) string {
	if rank(b) > rank(a) {
		return b
	}
	return a
}

// Validate reports whether a rule can be saved
func (r Rule) Validate() error {
	if !IsLevel(r.Other) {
		return errors.New("invalid default access level: " + r.Other)
	}
	for group, level := range r.Groups {
		if group == "" {
			return errors.New("a row has no group")
		}
		if !IsLevel(level) {
			return errors.New("invalid level for group " + group + ": " + level)
		}
	}
	return nil
}

// Clone returns a copy that shares nothing with r
func (r Rule) Clone() Rule {
	clone := Rule{Other: r.Other}
	if len(r.Groups) > 0 {
		clone.Groups = make(map[string]string, len(r.Groups))
		for group, level := range r.Groups {
			clone.Groups[group] = level
		}
	}
	return clone
}

// Explain works out a user's level on a drive and why. The first of these
// that applies wins:
//
//  1. user:/ and tmp:/ are open to everyone
//  2. members of the drive's home group have full access
//  3. admins have full access to the drives of the system pool
//  4. the highest row of the user's groups, which may be None
//  5. the default access level
//
// The result is then capped at Read on a read only drive.
func Explain(drive Drive, subject Subject, rule Rule) Decision {
	decision := decide(drive, subject, rule)
	decision.Level = normalize(decision.Level)
	if drive.ReadOnly && rank(decision.Level) > rank(Read) {
		decision.Level = Read
		decision.Capped = true
	}
	return decision
}

func decide(drive Drive, subject Subject, rule Rule) Decision {
	if IsFixed(drive.UUID) {
		return Decision{Level: ReadWrite, Reason: ReasonFixed}
	}

	if drive.HomeGroup != "" {
		for _, group := range subject.Groups {
			if group == drive.HomeGroup {
				return Decision{Level: ReadWrite, Reason: ReasonHome, Group: group}
			}
		}
	} else if subject.IsAdmin {
		return Decision{Level: ReadWrite, Reason: ReasonAdmin}
	}

	//Groups are walked in a fixed order so a tie names the same group each time
	groups := append([]string{}, subject.Groups...)
	sort.Strings(groups)
	matched := false
	best := Decision{Level: None, Reason: ReasonGroup}
	for _, group := range groups {
		level, ok := rule.Groups[group]
		if !ok {
			continue
		}
		if !matched || rank(level) > rank(best.Level) {
			best.Level = level
			best.Group = group
		}
		matched = true
	}
	if matched {
		return best
	}

	return Decision{Level: rule.Other, Reason: ReasonOther}
}

// normalize turns anything that is not a level into None
func normalize(level string) string {
	if IsLevel(level) {
		return level
	}
	return None
}

// Level returns a user's level on a drive, see Explain
func Level(drive Drive, subject Subject, rule Rule) string {
	return Explain(drive, subject, rule).Level
}
