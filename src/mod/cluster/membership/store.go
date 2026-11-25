package membership

/*
	ArozOS Cluster - persistence

	All cluster state lives in its own key-value database file (cluster.db,
	separate from the main ao.db) so it can be wiped or moved independently.

	Tables:
		cluster    "info"      -> ClusterInfo
		nodes      <nodeID>    -> NodeRecord
		jointokens <tokenID>   -> JoinToken (with secret hash)
		config     "local"     -> LocalConfig
*/

import (
	"encoding/json"
	"sync"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/info/logger"
)

const (
	tableCluster    = "cluster"
	tableNodes      = "nodes"
	tableJoinTokens = "jointokens"
	tableConfig     = "config"

	// TableIdentity is the cluster.db table used by the identity service for
	// its cluster-scoped records; it is wiped together with the membership.
	TableIdentity = "identity"
)

var (
	extraTablesMu      sync.Mutex
	extraClusterTables = []string{}
	currentStore       *store
)

// RegisterClusterTable declares a cluster.db table owned by a sibling cluster
// service. It is created when the store opens (or right away when a store is
// already open) and dropped together with the membership when the node
// leaves the cluster.
func RegisterClusterTable(name string) {
	if logger.IsDebug() {
		logger.Debugf("cluster/membership", "RegisterClusterTable: name=%.120q", name)
	}
	extraTablesMu.Lock()
	defer extraTablesMu.Unlock()
	for _, t := range extraClusterTables {
		if t == name {
			return
		}
	}
	extraClusterTables = append(extraClusterTables, name)
	if currentStore != nil {
		currentStore.db.NewTable(name)
	}
}

func registeredClusterTables() []string {
	logger.Debug("cluster/membership", "registeredClusterTables")
	extraTablesMu.Lock()
	defer extraTablesMu.Unlock()
	return append([]string{}, extraClusterTables...)
}

// store wraps the key-value database with typed accessors.
type store struct {
	db *database.Database
}

// storedJoinToken is the on-disk form, which unlike the API form keeps the hash.
type storedJoinToken struct {
	ID         string `json:"id"`
	SecretHash string `json:"secretHash"`
	Created    int64  `json:"created"`
	Expires    int64  `json:"expires"`
	Uses       int    `json:"uses"`
}

func newStore(dbfile string) (*store, error) {
	if logger.IsDebug() {
		logger.Debugf("cluster/membership", "newStore: dbfile=%.120q", dbfile)
	}
	db, err := database.NewDatabase(dbfile, false)
	if err != nil {
		return nil, err
	}
	tables := append([]string{tableCluster, tableNodes, tableJoinTokens, tableConfig, TableIdentity}, registeredClusterTables()...)
	for _, table := range tables {
		if err := db.NewTable(table); err != nil {
			db.Close()
			return nil, err
		}
	}
	st := &store{db: db}
	extraTablesMu.Lock()
	currentStore = st
	extraTablesMu.Unlock()
	return st, nil
}

func (s *store) close() {
	logger.Debug("cluster/membership", "store.close")
	extraTablesMu.Lock()
	if currentStore == s {
		currentStore = nil
	}
	extraTablesMu.Unlock()
	s.db.Close()
}

func (s *store) loadCluster() *ClusterInfo {
	logger.Debug("cluster/membership", "store.loadCluster")
	if !s.db.KeyExists(tableCluster, "info") {
		return nil
	}
	var info ClusterInfo
	if err := s.db.Read(tableCluster, "info", &info); err != nil || info.ID == "" {
		return nil
	}
	return &info
}

func (s *store) saveCluster(info *ClusterInfo) error {
	logger.DebugTrace("cluster/membership", "store.saveCluster")
	return s.db.Write(tableCluster, "info", info)
}

func (s *store) loadConfig() LocalConfig {
	logger.Debug("cluster/membership", "store.loadConfig")
	var cfg LocalConfig
	if s.db.KeyExists(tableConfig, "local") {
		s.db.Read(tableConfig, "local", &cfg)
	}
	return cfg
}

func (s *store) saveConfig(cfg LocalConfig) error {
	logger.DebugTrace("cluster/membership", "store.saveConfig")
	return s.db.Write(tableConfig, "local", cfg)
}

func (s *store) loadNodes() map[string]*NodeRecord {
	logger.Debug("cluster/membership", "store.loadNodes")
	nodes := map[string]*NodeRecord{}
	entries, err := s.db.ListTable(tableNodes)
	if err != nil {
		return nodes
	}
	for _, kv := range entries {
		var rec NodeRecord
		if err := json.Unmarshal(kv[1], &rec); err != nil || rec.ID == "" {
			continue
		}
		nodes[rec.ID] = &rec
	}
	return nodes
}

func (s *store) saveNode(rec *NodeRecord) error {
	logger.DebugTrace("cluster/membership", "store.saveNode")
	return s.db.Write(tableNodes, rec.ID, rec)
}

func (s *store) deleteNode(id string) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("cluster/membership", "store.deleteNode: id=%.120q", id)
	}
	return s.db.Delete(tableNodes, id)
}

func (s *store) loadJoinTokens() map[string]*JoinToken {
	logger.Debug("cluster/membership", "store.loadJoinTokens")
	tokens := map[string]*JoinToken{}
	entries, err := s.db.ListTable(tableJoinTokens)
	if err != nil {
		return tokens
	}
	for _, kv := range entries {
		var st storedJoinToken
		if err := json.Unmarshal(kv[1], &st); err != nil || st.ID == "" {
			continue
		}
		tokens[st.ID] = &JoinToken{ID: st.ID, SecretHash: st.SecretHash, Created: st.Created, Expires: st.Expires, Uses: st.Uses}
	}
	return tokens
}

func (s *store) saveJoinToken(t *JoinToken) error {
	logger.DebugTrace("cluster/membership", "store.saveJoinToken")
	return s.db.Write(tableJoinTokens, t.ID, storedJoinToken{ID: t.ID, SecretHash: t.SecretHash, Created: t.Created, Expires: t.Expires, Uses: t.Uses})
}

func (s *store) deleteJoinToken(id string) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("cluster/membership", "store.deleteJoinToken: id=%.120q", id)
	}
	return s.db.Delete(tableJoinTokens, id)
}

// wipeCluster removes every cluster-scoped record but keeps the local config.
func (s *store) wipeCluster() error {
	logger.Debug("cluster/membership", "store.wipeCluster")
	tables := append([]string{tableCluster, tableNodes, tableJoinTokens, TableIdentity}, registeredClusterTables()...)
	for _, table := range tables {
		if err := s.db.DropTable(table); err != nil {
			return err
		}
		if err := s.db.NewTable(table); err != nil {
			return err
		}
	}
	return nil
}
