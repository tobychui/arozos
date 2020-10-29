package storage


import (
	du "github.com/ricochet2200/go-disk-usage/du"
)
/*
	File for putting return structs

*/

func GetDriveCapacity(drive string) (uint64, uint64, uint64){
	usage := du.NewDiskUsage(drive)
	free := usage.Free();
	total := usage.Size();
	avi := usage.Available();
	return free, total, avi
}