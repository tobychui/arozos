package storage

import "imuslab.com/arozos/mod/info/logger"
import du "imuslab.com/arozos/mod/storage/du"

/*
	File for putting return structs

*/

func GetDriveCapacity(drive string) (uint64, uint64, uint64) {
	if logger.IsDebug() {
		logger.Debugf("storage", "GetDriveCapacity: drive=%.120q", drive)
	}
	usage := du.NewDiskUsage(drive)
	free := usage.Free()
	total := usage.Size()
	avi := usage.Available()
	return free, total, avi
}
