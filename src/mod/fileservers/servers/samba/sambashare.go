package samba

import "encoding/json"

/*
	This script handle the functions related to samba shares
*/

// Wrapper to save changes to file. Note that the name cannot be changed
// or otherwise there will be save issue. Use rename instead for name change
func (s *ShareConfig) SaveToConfig() error {
	//Deep copy of the current share config
	newShareConfig := ShareConfig{}
	originalConfigBytes, _ := json.Marshal(s)
	err := json.Unmarshal(originalConfigBytes, &newShareConfig)
	if err != nil {
		return err
	}

	//Remove the old one in smb.conf and inject new one
	shareManager := s.parent
	err = shareManager.RemoveSambaShareConfig(s.Name)
	if err != nil {
		return err
	}

	return shareManager.CreateNewSambaShare(&newShareConfig)
}

//Remove this share
func (s *ShareConfig) Remove() error {
	return s.parent.RemoveSambaShareConfig(s.Name)
}

func (s *ShareConfig) Rename(newName string) error {
	//Deep copy of the current share config
	newShareConfig := ShareConfig{}
	originalConfigBytes, _ := json.Marshal(s)
	err := json.Unmarshal(originalConfigBytes, &newShareConfig)
	if err != nil {
		return err
	}

	//Change the name and create the new one, then remove the old share
	newShareConfig.Name = newName
	err = s.parent.CreateNewSambaShare(&newShareConfig)
	if err != nil {
		return err
	}
	return s.Remove()
}
