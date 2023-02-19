package bridge

import (
	"encoding/json"
	"errors"
	"os"
)

/*
	Bridge.go

	This module handle File System Handler bridging cross different storage pool
	Tricky to use, use with your own risk and make sure admin permission is
	nessary for all request to this module.
*/

type Record struct {
	Filename string
}

type BridgeConfig struct {
	FSHUUID string
	SPOwner string
}

func NewBridgeRecord(filename string) *Record {
	return &Record{
		Filename: filename,
	}
}

// Read bridge record
func (r *Record) ReadConfig() ([]*BridgeConfig, error) {
	result := []*BridgeConfig{}

	if _, err := os.Stat(r.Filename); os.IsNotExist(err) {
		//File not exists. Create it
		js, _ := json.Marshal([]*BridgeConfig{})
		os.WriteFile(r.Filename, js, 0775)
	}

	content, err := os.ReadFile(r.Filename)
	if err != nil {
		return result, err
	}

	err = json.Unmarshal(content, &result)
	if err != nil {
		return result, err
	}
	return result, nil
}

// Append a new config into the Bridge Record
func (r *Record) AppendToConfig(config *BridgeConfig) error {
	currentConfigs, err := r.ReadConfig()
	if err != nil {
		return err
	}

	//Check if this config already exists
	for _, previousConfig := range currentConfigs {
		if previousConfig.FSHUUID == config.FSHUUID && previousConfig.SPOwner == config.SPOwner {
			//Already exists
			return errors.New("Idential config already registered")
		}
	}

	currentConfigs = append(currentConfigs, config)

	err = r.WriteConfig(currentConfigs)
	return err
}

// Remove a given config from file
func (r *Record) RemoveFromConfig(FSHUUID string, groupOwner string) error {
	currentConfigs, err := r.ReadConfig()
	if err != nil {
		return err
	}

	newConfigs := []*BridgeConfig{}
	for _, config := range currentConfigs {
		if !(config.SPOwner == groupOwner && config.FSHUUID == FSHUUID) {
			newConfigs = append(newConfigs, config)
		}
	}

	err = r.WriteConfig(newConfigs)
	return err

}

// Check if the given UUID in this pool is a bridge object
func (r *Record) IsBridgedFSH(FSHUUID string, groupOwner string) (bool, error) {
	currentConfigs, err := r.ReadConfig()
	if err != nil {
		return false, err
	}

	for _, config := range currentConfigs {
		if config.SPOwner == groupOwner && config.FSHUUID == FSHUUID {
			return true, nil
		}
	}
	return false, nil
}

//Get a list of group owners that have this fsh uuid as "bridged" fs
func (r *Record) GetBridgedGroups(FSHUUID string) []string {
	results := []string{}
	currentConfigs, err := r.ReadConfig()
	if err != nil {
		return results
	}

	for _, config := range currentConfigs {
		if config.FSHUUID == FSHUUID {
			results = append(results, config.SPOwner)
		}
	}
	return results
}

// Write FSHConfig to disk
func (r *Record) WriteConfig(config []*BridgeConfig) error {
	js, _ := json.MarshalIndent(config, "", " ")
	err := os.WriteFile(r.Filename, js, 0775)
	return err
}
