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

	"imuslab.com/arozos/mod/database"
)

const (
	tableCluster    = "cluster"
	tableNodes      = "nodes"
	tableJoinTokens = "jointokens"
	tableConfig     = "config"
)

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
	db, err := database.NewDatabase(dbfile, false)
	if err != nil {
		return nil, err
	}
	for _, table := range []string{tableCluster, tableNodes, tableJoinTokens, tableConfig} {
		if err := db.NewTable(table); err != nil {
			db.Close()
			return nil, err
		}
	}
	return &store{db: db}, nil
}

func (s *store) close() {
	s.db.Close()
}

func (s *store) loadCluster() *ClusterInfo {
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
	return s.db.Write(tableCluster, "info", info)
}

func (s *store) loadConfig() LocalConfig {
	var cfg LocalConfig
	if s.db.KeyExists(tableConfig, "local") {
		s.db.Read(tableConfig, "local", &cfg)
	}
	return cfg
}

func (s *store) saveConfig(cfg LocalConfig) error {
	return s.db.Write(tableConfig, "local", cfg)
}

func (s *store) loadNodes() map[string]*NodeRecord {
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
	return s.db.Write(tableNodes, rec.ID, rec)
}

func (s *store) deleteNode(id string) error {
	return s.db.Delete(tableNodes, id)
}

func (s *store) loadJoinTokens() map[string]*JoinToken {
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
	return s.db.Write(tableJoinTokens, t.ID, storedJoinToken{ID: t.ID, SecretHash: t.SecretHash, Created: t.Created, Expires: t.Expires, Uses: t.Uses})
}

func (s *store) deleteJoinToken(id string) error {
	return s.db.Delete(tableJoinTokens, id)
}

// wipeCluster removes every cluster-scoped record but keeps the local config.
func (s *store) wipeCluster() error {
	for _, table := range []string{tableCluster, tableNodes, tableJoinTokens} {
		if err := s.db.DropTable(table); err != nil {
			return err
		}
		if err := s.db.NewTable(table); err != nil {
			return err
		}
	}
	return nil
}
