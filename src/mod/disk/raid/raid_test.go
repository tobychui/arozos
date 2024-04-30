package raid_test

/*
	RAID TEST SCRIPT

	!!!! DO NOT RUN IN PRODUCTION !!!!
	ONLY RUN IN VM ENVIRONMENT
*/

/*
func TestRemoveRAIDFromConfig(t *testing.T) {
	err := raid.RemoveVolumeFromMDADMConfig("cbc11a2b:fbd42653:99c1340b:9c4962fb")
	if err != nil {
		t.Errorf("Unexpected error: %v", err)
		return
	}
}
*/

/*
func TestAddRAIDToConfig(t *testing.T) {
	err := raid.UpdateMDADMConfig()
	if err != nil {
		t.Errorf("Unexpected error: %v", err)
		return
	}
}
*/

/*
func TestReadRAIDInfo(t *testing.T) {
	raidInfo, err := raid.GetRAIDInfo("/dev/md0")
	if err != nil {
		t.Errorf("Unexpected error: %v", err)
		return
	}

	//Pretty print info for debug
	raidInfo.PrettyPrintRAIDInfo()
}

*/

/*
func TestCreateRAIDDevice(t *testing.T) {
	//Create an empty Manager
	manager, _ := raid.NewRaidManager(raid.Options{})

	// Make sure the sdb and sdc exists when running test case in VM
	devName, _ := raid.GetNextAvailableMDDevice()
	raidLevel := 1
	raidDeviceIds := []string{"/dev/sdb", "/dev/sdc"}
	spareDeviceIds := []string{}

	//Format the drives
	for _, partion := range raidDeviceIds {
		fmt.Println("Wiping partition: " + partion)
		err := manager.WipeDisk(partion)
		if err != nil {
			t.Errorf("Disk wipe error: %v", err)
			return
		}
	}

	// Call the function being tested
	err := manager.CreateRAIDDevice(devName, raidLevel, raidDeviceIds, spareDeviceIds)
	if err != nil {
		t.Errorf("Unexpected error: %v", err)
		return
	}

	fmt.Println("RAID array created")

}

*/
