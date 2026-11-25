package samba

import "imuslab.com/arozos/mod/info/logger"
import "encoding/json"

/*
	This script handle the functions related to samba shares
*/

// Wrapper to save changes to file. Note that the name cannot be changed
// or otherwise there will be save issue. Use rename instead for name change
func (s *ShareConfig) SaveToConfig() (out0 error) {
	defer logger.Out1(logger.In1("fileservers/servers/samba", "ShareConfig.SaveToConfig", "s", s), &out0)
	//Deep copy of the current share config
	newShareConfig := ShareConfig{}
	originalConfigBytes, _ := json.Marshal(s)
	err := json.Unmarshal(originalConfigBytes, &newShareConfig)
	if err != nil {
		logger.DebugErr("fileservers/servers/samba", err)
		return err
	}

	//Remove the old one in smb.conf and inject new one
	shareManager := s.parent
	err = shareManager.RemoveSambaShareConfig(s.Name)
	if err != nil {
		logger.DebugErr("fileservers/servers/samba", err)
		return err
	}

	return shareManager.CreateNewSambaShare(&newShareConfig)
}

// Remove this share
func (s *ShareConfig) Remove() (out0 error) {
	defer logger.Out1(logger.In1("fileservers/servers/samba", "ShareConfig.Remove", "s", s), &out0)
	return s.parent.RemoveSambaShareConfig(s.Name)
}

func (s *ShareConfig) Rename(newName string) (out0 error) {
	defer logger.Out1(logger.In2("fileservers/servers/samba", "ShareConfig.Rename", "s", s, "newName", newName), &out0)
	//Deep copy of the current share config
	newShareConfig := ShareConfig{}
	originalConfigBytes, _ := json.Marshal(s)
	err := json.Unmarshal(originalConfigBytes, &newShareConfig)
	if err != nil {
		logger.DebugErr("fileservers/servers/samba", err)
		return err
	}

	//Change the name and create the new one, then remove the old share
	newShareConfig.Name = newName
	err = s.parent.CreateNewSambaShare(&newShareConfig)
	if err != nil {
		logger.DebugErr("fileservers/servers/samba", err)
		return err
	}
	return s.Remove()
}
