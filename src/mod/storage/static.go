package storage

import "imuslab.com/arozos/mod/info/logger"
import du "imuslab.com/arozos/mod/storage/du"

/*
	File for putting return structs

*/

func GetDriveCapacity(drive string) (out0 uint64, out1 uint64, out2 uint64) {
	defer logger.Out3(logger.In1("storage", "GetDriveCapacity", "drive", drive), &out0, &out1, &out2)
	usage := du.NewDiskUsage(drive)
	free := usage.Free()
	total := usage.Size()
	avi := usage.Available()
	return free, total, avi
}
