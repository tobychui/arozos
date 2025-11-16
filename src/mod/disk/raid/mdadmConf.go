package raid

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"strings"
	"time"

	"imuslab.com/arozos/mod/disk/diskfs"
	"imuslab.com/arozos/mod/utils"
)

/*
	mdadmConf.go

	This package handles the config modification and update for
	the mdadm module


*/

// Force mdadm to stop all RAID and load fresh from config file
// on some Linux distro this is required as mdadm start too early
func (m *Manager) FlushReload() error {
	//Get a list of currently running RAID devices
	raidDevices, err := m.GetRAIDDevicesFromProcMDStat()
	if err != nil {
		return err
	}

	//Stop all of the running RAID devices
	for _, rd := range raidDevices {

		//Check if it is mounted. If yes, skip this
		devMounted, err := diskfs.DeviceIsMounted("/dev/" + rd.Name)
		if devMounted || err != nil {
			log.Println("[RAID] " + "/dev/" + rd.Name + " is in use. Skipping.")
			continue
		}
		log.Println("[RAID] Stopping " + rd.Name)

		cmdMdadm := exec.Command("sudo", "mdadm", "--stop", "/dev/"+rd.Name)

		// Run the command and capture its output
		_, err = cmdMdadm.Output()
		if err != nil {
			log.Println("[RAID] Unable to stop " + rd.Name + ". Skipping")
			continue
		}
	}

	time.Sleep(300 * time.Millisecond)

	//Assemble mdadm array again
	err = m.RestartRAIDService()
	if err != nil {
		return err
	}

	return nil
}

// removeDevicesEntry remove device hardcode from mdadm config file
func removeDevicesEntry(configLine string) string {
	// Split the config line by space character
	tokens := strings.Fields(configLine)

	// Iterate through the tokens to find and remove the devices=* part
	for i, token := range tokens {
		if strings.HasPrefix(token, "devices=") {
			// Remove the devices=* part from the slice
			tokens = append(tokens[:i], tokens[i+1:]...)
			break
		}
	}

	// Join the tokens back into a single string
	updatedConfigLine := strings.Join(tokens, " ")

	return updatedConfigLine
}

// Updates the mdadm configuration file with the details of RAID arrays
// so the RAID drive will still be seen after a reboot (hopefully)
// this will automatically add / remove config base on current runtime setup
func (m *Manager) UpdateMDADMConfig() error {
	cmdMdadm := exec.Command("sudo", "mdadm", "--detail", "--scan", "--verbose")

	// Run the command and capture its output
	output, err := cmdMdadm.Output()
	if err != nil {
		return fmt.Errorf("error running mdadm command: %v", err)
	}

	//Load the config from system
	currentConfigBytes, err := os.ReadFile("/etc/mdadm/mdadm.conf")
	if err != nil {
		return fmt.Errorf("unable to open mdadm.conf: %w", err)
	}
	currentConf := string(currentConfigBytes)

	//Check if the current config already contains the setting
	newConfigLines := []string{}
	uuidsInNewConfig := []string{}
	arrayConfigs := strings.TrimSpace(string(output))
	lines := strings.Split(arrayConfigs, "ARRAY")
	for _, line := range lines {
		//For each line, you should have something like this
		//ARRAY /dev/md0 metadata=1.2 name=debian:0 UUID=cbc11a2b:fbd42653:99c1340b:9c4962fb
		//   devices=/dev/sdb,/dev/sdc
		//Building structure for RAID Config Record

		line = strings.ReplaceAll(line, "\n", " ")
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		poolUUID := strings.TrimPrefix(fields[3], "UUID=")
		uuidsInNewConfig = append(uuidsInNewConfig, poolUUID)
		//Check if this uuid already in the config file
		if strings.Contains(currentConf, poolUUID) {
			continue
		}

		//This config not exists in the settings. Add it to append lines
		m.Options.Logger.PrintAndLog("RAID", "Adding "+fields[0]+" (UUID="+poolUUID+") into mdadm config", nil)
		settingLine := "ARRAY " + strings.Join(fields, " ")

		//Remove the device specific names
		settingLine = removeDevicesEntry(settingLine)
		newConfigLines = append(newConfigLines, settingLine)
	}

	originalConfigLines := strings.Split(strings.TrimSpace(currentConf), "\n")
	poolUUIDToBeRemoved := []string{}
	for _, line := range originalConfigLines {
		lineFields := strings.Fields(line)
		for _, thisField := range lineFields {
			if strings.HasPrefix(thisField, "UUID=") {
				//This is the UUID of this array. Check if it still exists in new storage config
				thisPoolUUID := strings.TrimPrefix(thisField, "UUID=")
				existsInNewConfig := utils.StringInArray(uuidsInNewConfig, thisPoolUUID)
				if !existsInNewConfig {
					//Label this UUID to be removed
					poolUUIDToBeRemoved = append(poolUUIDToBeRemoved, thisPoolUUID)
				}

				//Skip scanning the remaining fields of this RAID pool
				break
			}
		}
	}

	if len(poolUUIDToBeRemoved) > 0 {
		//Remove the old UUIDs from config
		for _, volumeUUID := range poolUUIDToBeRemoved {
			err = m.RemoveVolumeFromMDADMConfig(volumeUUID)
			if err != nil {
				log.Println("[RAID] Error when trying to remove old RAID volume from config: " + err.Error())
				return err
			} else {
				log.Println("[RAID] RAID volume " + volumeUUID + " removed from config file")
			}
		}

	}

	if len(newConfigLines) == 0 {
		//Nothing to write
		log.Println("[RAID] Nothing to write. Skipping mdadm config update.")
		return nil
	}

	// Construct the bash command to append the line to mdadm.conf using echo and tee
	for _, configLine := range newConfigLines {
		cmd := exec.Command("bash", "-c", fmt.Sprintf(`echo "%s" | sudo tee -a /etc/mdadm/mdadm.conf`, configLine))

		// Run the command
		err := cmd.Run()
		if err != nil {
			return fmt.Errorf("error injecting line into mdadm.conf: %v", err)
		}
	}

	return nil
}

// Removes a RAID volume from the mdadm configuration file given its volume UUID.
// Note that this only remove a single line of config. If your line consists of multiple lines
// you might need to remove it manually
func (m *Manager) RemoveVolumeFromMDADMConfig(volumeUUID string) error {
	// Construct the sed command to remove the line containing the volume UUID from mdadm.conf
	sedCommand := fmt.Sprintf(`sudo sed -i '/UUID=%s/d' /etc/mdadm/mdadm.conf`, volumeUUID)

	// Execute the sed command
	cmd := exec.Command("bash", "-c", sedCommand)
	err := cmd.Run()
	if err != nil {
		return fmt.Errorf("error removing volume from mdadm.conf: %v", err)
	}

	return nil
}
