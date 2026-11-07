package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"path/filepath"
	"sync"

	"imuslab.com/arozos/mod/cluster/metadata"
	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/storage/access"
)

/*
	Drive access lists

	Wires mod/storage/access into the system: where the rules of this host are
	kept, the replicated rule of cluster:/ and what has to follow a rule change.
*/

const (
	driveAccessRuleFile = "storage.access.json" //Under system/, not system/storage/ where files are named after groups
	driveBridgeFile     = "bridge.json"         //What earlier builds kept their bridges in, see DriveAccessInit
	clusterDriveRuleKey = "storage.access.cluster"
)

var driveAccessStore *access.Store

// driveRuleSource answers which rule a drive has. Every member of a cluster
// serves the same files, so the rule of cluster:/ lives with the cluster
// metadata; a local rule there would leave the files open through another node.
type driveRuleSource struct{}

func (driveRuleSource) Rule(uuid string) (access.Rule, bool) {
	if uuid == access.ClusterDriveID {
		return clusterDriveRule()
	}
	return driveAccessStore.Rule(uuid)
}

// DriveAccessInit opens the rules. It runs once every pool is loaded, since
// converting the old bridges needs to know where each drive lives.
func DriveAccessInit() {
	driveAccessStore = access.NewStore(filepath.Join("system", driveAccessRuleFile))
	if err := driveAccessStore.Err(); err != nil {
		systemWideLogger.PrintAndLog("Storage", "Unable to read the drive access rules, every drive is closed to non admins until "+driveAccessRuleFile+" is repaired", err)
	}
	userHandler.SetDriveRules(driveRuleSource{})
	permissionHandler.OnGroupRemoved = func(group string) {
		if err := driveAccessStore.RemoveGroup(group); err != nil {
			systemWideLogger.PrintAndLog("Storage", "Unable to remove group "+group+" from the drive access rules", err)
		}
		driveAccessChanged()
	}

	count, err := driveAccessStore.MigrateBridges(filepath.Join("system", driveBridgeFile), drivePoolHome)
	if err != nil {
		systemWideLogger.PrintAndLog("Storage", "Unable to convert the storage bridges into drive access rules", err)
	} else if count > 0 {
		systemWideLogger.PrintAndLog("Storage", "Converted the storage bridges into drive access rules", nil)
	}

	for _, uuid := range duplicateDriveIDs(collectPoolStates()) {
		systemWideLogger.PrintAndLog("Storage", "Drive id "+uuid+":/ is used by more than one storage pool. Its access rule applies to all of them; give each drive its own id", nil)
	}
}

// drivePoolHome returns the home group of a drive, empty for the system pool,
// and whether any pool holds or configures it
func drivePoolHome(uuid string) (string, bool) {
	for _, pool := range collectPoolStates() {
		if pool.holds(uuid) {
			if pool.owner == storagePoolSystem {
				return "", true
			}
			return pool.owner, true
		}
	}
	return "", false
}

// driveAccessChanged is called after anything that changes who may use a
// drive. Requests read the rules directly; these are the parts that keep a
// copy of the outcome.
func driveAccessChanged() {
	userHandler.ResetQuotaManagers()
	if SambaShareManager != nil {
		go func() {
			if err := SambaShareManager.SyncDriveAccess(); err != nil {
				systemWideLogger.PrintAndLog("Storage", "Unable to update the Samba shares after a drive access change", err)
			}
		}()
	}
}

// setDriveRule saves the rule of a drive where that drive keeps it
func setDriveRule(uuid string, rule access.Rule) error {
	if uuid == access.ClusterDriveID {
		return clusterSetDriveRule(rule)
	}
	return driveAccessStore.Set(uuid, rule)
}

// effectiveDriveRule returns the rule a drive has right now, saved or default
func effectiveDriveRule(rules access.Source, uuid string, home string) access.Rule {
	if rule, ok := rules.Rule(uuid); ok {
		return rule
	}
	return access.DefaultRule(uuid, home)
}

/*
	The replicated rule of cluster:/
*/

// The last parsed rule. Access is checked on every request, so the rule is
// only parsed again when the replicated value differs.
var (
	clusterRuleMu    sync.Mutex
	clusterRuleRaw   []byte
	clusterRuleValue access.Rule
)

// clusterDriveRule returns the rule of cluster:/ this node knows
func clusterDriveRule() (access.Rule, bool) {
	if clusterMetadata == nil {
		return access.Rule{}, false
	}
	setting, ok := clusterMetadata.Setting(clusterDriveRuleKey)
	if !ok {
		return access.Rule{}, false
	}

	clusterRuleMu.Lock()
	defer clusterRuleMu.Unlock()
	if clusterRuleRaw == nil || !bytes.Equal(clusterRuleRaw, setting.Value) {
		clusterRuleValue = parseClusterDriveRule(setting.Value)
		clusterRuleRaw = append([]byte{}, setting.Value...)
	}
	return clusterRuleValue.Clone(), true
}

// parseClusterDriveRule reads a replicated rule. One that cannot be read, say
// from a newer member, closes the drive rather than opening it.
func parseClusterDriveRule(raw []byte) access.Rule {
	rule := access.Rule{}
	if err := json.Unmarshal(raw, &rule); err != nil || rule.Validate() != nil {
		systemWideLogger.PrintAndLog("Cluster", "The cluster:/ access rule cannot be read, closing the drive to non admins", err)
		return access.Rule{Other: access.None}
	}
	return rule
}

// clusterSetDriveRule replicates a new rule of cluster:/ to every member
func clusterSetDriveRule(rule access.Rule) error {
	if clusterMetadata == nil || clusterManager == nil || !clusterManager.InCluster() {
		return errors.New("this node is not in a cluster")
	}
	js, err := json.Marshal(rule)
	if err != nil {
		return err
	}
	return clusterMetadata.Submit(metadata.KindSetting, &metadata.Setting{Key: clusterDriveRuleKey, Value: js})
}

// clusterSettingChanged follows a change of a replicated setting
func clusterSettingChanged(payload []byte) {
	setting := metadata.Setting{}
	if err := json.Unmarshal(payload, &setting); err != nil || setting.Key != clusterDriveRuleKey {
		return
	}
	driveAccessChanged()
}

// clusterDatasetAllowed refuses a job dataset to a user who cannot read
// cluster:/, because the dataset pattern is expanded from the metadata index
// and would hand the job the names of files the user may not see.
func clusterDatasetAllowed(username string, dataset string) error {
	if dataset == "" {
		return nil
	}
	userinfo, err := userHandler.GetUserInfoFromUsername(username)
	if err != nil {
		return err
	}
	if !userinfo.CanRead(access.ClusterDriveID + ":/") {
		return errors.New("access to cluster:/ denied")
	}
	return nil
}

// isClusterOrShareDrive reports whether a drive is built by code rather than
// from a config row, so it cannot be rebuilt from its start options
func isClusterOrShareDrive(fsh *fs.FileSystemHandler) bool {
	return fsh.UUID == access.ClusterDriveID || fsh.UUID == access.ShareDriveID
}
