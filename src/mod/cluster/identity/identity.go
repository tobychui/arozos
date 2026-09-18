package identity

/*
	ArozOS Cluster - identity service (AID)

	One member of the cluster can be elected the "identity origin" (SSO
	owner). Every other member then:

	  1. forwards login attempts to the origin (forward auth): the origin
	     checks the SHA-512 password hash against its own account table and
	     answers with the user's groups. The member mirrors the account
	     locally (hash + groups that exist on the member) and opens a normal
	     local session.
	  2. keeps a replicated copy of the origin's account directory so users
	     can still log in when the origin is unreachable (fallback).
	  3. forwards password changes of replicated accounts back to the origin.

	Accounts that exist only on a member (never replicated) are left alone,
	so every node still works standalone. Group membership is mapped by group
	NAME: only groups that exist locally are applied, because groups carry
	node-specific storage and module settings.
*/

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"imuslab.com/arozos/mod/auth"
	"imuslab.com/arozos/mod/cluster/acn"
	"imuslab.com/arozos/mod/cluster/membership"
	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/info/logger"
)

const (
	// DefaultSyncInterval is how often members pull the origin directory.
	DefaultSyncInterval = 5 * time.Minute
	forwardAuthTimeout  = 12 * time.Second
	keyManagedPrefix    = "managed/"
)

// AccountStore is what the identity service needs from the host's account
// system. The core adapts the auth agent and permission handler to it.
type AccountStore interface {
	UserExists(username string) bool
	PasswordHash(username string) (string, error)
	SetPasswordHash(username string, hash string) error
	Groups(username string) ([]string, error)
	SetGroups(username string, groups []string) error
	ListUsers() []string
	DeleteUser(username string) error
	GroupExists(group string) bool
}

// Account is one replicated user entry.
type Account struct {
	Username     string   `json:"username"`
	PasswordHash string   `json:"passwordHash"`
	Groups       []string `json:"groups"`
}

// Directory is the origin's full account list.
type Directory struct {
	Origin string    `json:"origin"`
	Users  []Account `json:"users"`
	Time   int64     `json:"time"`
}

// Wire payloads
type VerifyRequest struct {
	Username     string `json:"username"`
	PasswordHash string `json:"passwordHash"`
}

type VerifyResponse struct {
	OK     bool     `json:"ok"`
	Reason string   `json:"reason,omitempty"`
	Groups []string `json:"groups,omitempty"`
}

type SetPasswordRequest struct {
	Username     string `json:"username"`
	PasswordHash string `json:"passwordHash"`
}

// Option configures the identity service.
type Option struct {
	Membership   *membership.Manager
	Accounts     AccountStore
	SyncInterval time.Duration
}

// Manager is the identity service of this node.
type Manager struct {
	m   *membership.Manager
	acc AccountStore
	db  *database.Database

	mu           sync.Mutex
	managed      map[string]bool //accounts on this node that mirror the origin
	lastSync     int64
	lastSyncErr  string
	lastForward  int64
	lastForwardE string
	skipped      []string //directory users without a matching local group
	conflicts    []string //directory users shadowed by a local-only account
	interval     time.Duration

	stop    chan struct{}
	trigger chan struct{}
	once    sync.Once
}

// New creates the identity service and registers its ACN endpoints.
func New(opt Option) (*Manager, error) {
	if opt.Membership == nil || opt.Accounts == nil {
		return nil, errors.New("membership manager and account store are required")
	}
	if opt.SyncInterval <= 0 {
		opt.SyncInterval = DefaultSyncInterval
	}
	i := &Manager{
		m:        opt.Membership,
		acc:      opt.Accounts,
		db:       opt.Membership.DB(),
		managed:  map[string]bool{},
		interval: opt.SyncInterval,
		stop:     make(chan struct{}),
		trigger:  make(chan struct{}, 1),
	}
	i.db.NewTable(membership.TableIdentity)
	i.loadManaged()
	i.registerACNHandlers()
	prev := i.m.OnClusterChange
	i.m.OnClusterChange = func() {
		if prev != nil {
			prev()
		}
		i.TriggerSync()
	}
	go i.loop()
	return i, nil
}

// Close stops the background sync.
func (i *Manager) Close() {
	i.once.Do(func() { close(i.stop) })
}

func (i *Manager) loadManaged() {
	entries, err := i.db.ListTable(membership.TableIdentity)
	if err != nil {
		return
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	for _, kv := range entries {
		k := string(kv[0])
		if strings.HasPrefix(k, keyManagedPrefix) {
			i.managed[strings.TrimPrefix(k, keyManagedPrefix)] = true
		}
	}
}

func (i *Manager) markManaged(username string, origin string) {
	i.mu.Lock()
	i.managed[username] = true
	i.mu.Unlock()
	i.db.Write(membership.TableIdentity, keyManagedPrefix+username, origin)
}

func (i *Manager) unmarkManaged(username string) {
	i.mu.Lock()
	delete(i.managed, username)
	i.mu.Unlock()
	i.db.Delete(membership.TableIdentity, keyManagedPrefix+username)
}

// IsManaged reports whether an account on this node mirrors the origin.
func (i *Manager) IsManaged(username string) bool {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.managed[username]
}

// Origin returns the identity origin node and whether it is this node.
func (i *Manager) Origin() (nodeID string, isSelf bool) {
	origin := i.m.IdentityOrigin()
	return origin, origin != "" && origin == i.m.NodeID()
}

// forwardingActive is true when logins should be checked on another node.
func (i *Manager) forwardingActive() (string, bool) {
	origin, self := i.Origin()
	if origin == "" || self || !i.m.InCluster() {
		return "", false
	}
	return origin, true
}

// localGroups keeps only the groups that exist on this node.
func (i *Manager) localGroups(groups []string) []string {
	out := []string{}
	for _, g := range groups {
		if g != "" && i.acc.GroupExists(g) {
			out = append(out, g)
		}
	}
	return out
}

// mirrorAccount creates or updates the local copy of an origin account.
func (i *Manager) mirrorAccount(origin string, username string, hash string, groups []string) error {
	if err := i.acc.SetPasswordHash(username, hash); err != nil {
		return err
	}
	if err := i.acc.SetGroups(username, groups); err != nil {
		return err
	}
	i.markManaged(username, origin)
	return nil
}

/*
	Forward authentication
*/

// ForwardAuth is installed as the auth agent's ForwardAuth hook.
func (i *Manager) ForwardAuth(username string, passwordHash string) auth.ForwardAuthResult {
	origin, active := i.forwardingActive()
	if !active {
		return auth.ForwardAuthResult{}
	}
	if !validUsername(username) {
		return auth.ForwardAuthResult{Decided: true, Accepted: false, Reason: "Invalid username or password"}
	}

	ctx, cancel := context.WithTimeout(context.Background(), forwardAuthTimeout)
	defer cancel()
	var resp VerifyResponse
	err := i.m.Transport().DoJSON(ctx, origin, http.MethodPost, acn.BasePath+"/auth/verify", VerifyRequest{Username: username, PasswordHash: passwordHash}, &resp)
	i.mu.Lock()
	i.lastForward = time.Now().Unix()
	if err != nil {
		i.lastForwardE = err.Error()
	} else {
		i.lastForwardE = ""
	}
	i.mu.Unlock()
	if err != nil {
		//Origin unreachable: let the local (replicated) table decide
		logger.PrintAndLog("Cluster", "Identity origin unreachable, using local accounts: "+err.Error(), nil)
		return auth.ForwardAuthResult{}
	}
	if !resp.OK {
		reason := resp.Reason
		if reason == "" {
			reason = "Invalid username or password"
		}
		return auth.ForwardAuthResult{Decided: true, Accepted: false, Reason: reason}
	}

	//Mirror the account locally so the session and permissions resolve
	if i.acc.UserExists(username) && !i.IsManaged(username) {
		//A local-only account with the same name: keep it untouched but the
		//origin decided the password, so just let the user in with local groups
		return auth.ForwardAuthResult{Decided: true, Accepted: true}
	}
	groups := i.localGroups(resp.Groups)
	if len(groups) == 0 {
		return auth.ForwardAuthResult{Decided: true, Accepted: false, Reason: "None of your permission groups exist on this node. Ask an administrator to create a matching group."}
	}
	if err := i.mirrorAccount(origin, username, passwordHash, groups); err != nil {
		return auth.ForwardAuthResult{Decided: true, Accepted: false, Reason: "Unable to create your account on this node: " + err.Error()}
	}
	return auth.ForwardAuthResult{Decided: true, Accepted: true}
}

// NotifyPasswordChanged forwards a password change of a replicated account
// to the origin so it does not get reverted by the next sync.
func (i *Manager) NotifyPasswordChanged(username string, passwordHash string) {
	origin, active := i.forwardingActive()
	if !active || !i.IsManaged(username) {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), forwardAuthTimeout)
		defer cancel()
		err := i.m.Transport().DoJSON(ctx, origin, http.MethodPost, acn.BasePath+"/auth/setpassword", SetPasswordRequest{Username: username, PasswordHash: passwordHash}, nil)
		if err != nil {
			logger.PrintAndLog("Cluster", "Unable to forward password change of "+username+" to the identity origin: "+err.Error(), nil)
		}
	}()
}

/*
	Directory replication
*/

// buildDirectory lists the accounts of this node (served when it is the origin).
func (i *Manager) buildDirectory() Directory {
	dir := Directory{Origin: i.m.NodeID(), Users: []Account{}, Time: time.Now().Unix()}
	users := i.acc.ListUsers()
	sort.Strings(users)
	for _, u := range users {
		hash, err := i.acc.PasswordHash(u)
		if err != nil || hash == "" {
			continue
		}
		groups, _ := i.acc.Groups(u)
		if groups == nil {
			groups = []string{}
		}
		dir.Users = append(dir.Users, Account{Username: u, PasswordHash: hash, Groups: groups})
	}
	return dir
}

// applyDirectory mirrors the origin directory onto this node.
func (i *Manager) applyDirectory(origin string, dir Directory) {
	seen := map[string]bool{}
	skipped := []string{}
	conflicts := []string{}
	for _, a := range dir.Users {
		if !validUsername(a.Username) || a.PasswordHash == "" {
			continue
		}
		if i.acc.UserExists(a.Username) && !i.IsManaged(a.Username) {
			conflicts = append(conflicts, a.Username)
			continue
		}
		groups := i.localGroups(a.Groups)
		if len(groups) == 0 {
			skipped = append(skipped, a.Username)
			continue
		}
		seen[a.Username] = true
		if err := i.mirrorAccount(origin, a.Username, a.PasswordHash, groups); err != nil {
			logger.PrintAndLog("Cluster", "Unable to mirror account "+a.Username+": "+err.Error(), nil)
		}
	}

	//Accounts we mirrored earlier that the origin no longer has
	i.mu.Lock()
	stale := []string{}
	for u := range i.managed {
		if !seen[u] {
			stale = append(stale, u)
		}
	}
	i.skipped = skipped
	i.conflicts = conflicts
	i.mu.Unlock()
	for _, u := range stale {
		if err := i.acc.DeleteUser(u); err == nil {
			logger.PrintAndLog("Cluster", "Removed replicated account "+u+" that no longer exists on the identity origin", nil)
		}
		i.unmarkManaged(u)
	}
}

// SyncNow pulls the origin directory once. It is a no-op on the origin
// itself or when forward authentication is disabled.
func (i *Manager) SyncNow() error {
	origin, active := i.forwardingActive()
	if !active {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var dir Directory
	err := i.m.Transport().DoJSON(ctx, origin, http.MethodGet, acn.BasePath+"/auth/directory", nil, &dir)
	i.mu.Lock()
	i.lastSync = time.Now().Unix()
	if err != nil {
		i.lastSyncErr = err.Error()
	} else {
		i.lastSyncErr = ""
	}
	i.mu.Unlock()
	if err != nil {
		return err
	}
	if dir.Origin != origin {
		return errors.New("directory came from an unexpected node")
	}
	i.applyDirectory(origin, dir)
	return nil
}

// TriggerSync asks the background loop to sync soon.
func (i *Manager) TriggerSync() {
	select {
	case i.trigger <- struct{}{}:
	default:
	}
}

func (i *Manager) loop() {
	ticker := time.NewTicker(i.interval)
	defer ticker.Stop()
	//Initial sync shortly after boot so members are warm before first login
	timer := time.NewTimer(3 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-i.stop:
			return
		case <-timer.C:
			i.SyncNow()
		case <-ticker.C:
			i.SyncNow()
		case <-i.trigger:
			i.SyncNow()
		}
	}
}

/*
	Status
*/

// Status is the identity picture for the settings UI.
type Status struct {
	Enabled          bool     `json:"enabled"`
	Origin           string   `json:"origin"`
	OriginName       string   `json:"originName"`
	IsOrigin         bool     `json:"isOrigin"`
	ManagedAccounts  int      `json:"managedAccounts"`
	LocalAccounts    int      `json:"localAccounts"`
	Skipped          []string `json:"skipped"`
	Conflicts        []string `json:"conflicts"`
	LastSync         int64    `json:"lastSync"`
	LastSyncError    string   `json:"lastSyncError"`
	LastForward      int64    `json:"lastForward"`
	LastForwardError string   `json:"lastForwardError"`
}

// Status builds the current identity status.
func (i *Manager) Status() Status {
	origin, self := i.Origin()
	i.mu.Lock()
	defer i.mu.Unlock()
	st := Status{
		Enabled:          origin != "",
		Origin:           origin,
		IsOrigin:         self,
		ManagedAccounts:  len(i.managed),
		LocalAccounts:    len(i.acc.ListUsers()),
		Skipped:          append([]string{}, i.skipped...),
		Conflicts:        append([]string{}, i.conflicts...),
		LastSync:         i.lastSync,
		LastSyncError:    i.lastSyncErr,
		LastForward:      i.lastForward,
		LastForwardError: i.lastForwardE,
	}
	if origin != "" {
		st.OriginName = i.m.NodeName(origin)
	}
	return st
}

func validUsername(u string) bool {
	if u == "" || len(u) > 128 {
		return false
	}
	return !strings.ContainsAny(u, "/\\\x00")
}
