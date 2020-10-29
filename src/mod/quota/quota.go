package quota

import (
	//"log"
	"os"
	"path/filepath"

	db "imuslab.com/aroz_online/mod/database"
	fs "imuslab.com/aroz_online/mod/filesystem"

)

/*
	ArOZ Online Storage Quota Limiting and Tracking Module
	author: tobychui

	This system track and limit the quota of the users.
*/

type QuotaHandler struct{
	database *db.Database		//System database for storing data
	username string				//The current username for this handler
	fspool []*fs.FileSystemHandler
	TotalStorageQuota int64		
	UsedStorageQuota int64
}

//Create a storage quotation handler for this user
func NewUserQuotaHandler(database *db.Database, username string, fsh []*fs.FileSystemHandler, defaultQuota int64) *QuotaHandler{
	//Create the quota table if not exists
	totalQuota := defaultQuota	//Use defalt quota if init first time
	err := database.NewTable("quota")
	if err != nil{
		//Set this account to readonly.
		return &QuotaHandler{
			database: database,
			username: username,
			fspool: fsh,
			TotalStorageQuota: 0,
			UsedStorageQuota: 0,
		}
	}

	//Get the user storage quota
	if !database.KeyExists("quota",username + "/quota"){
		//This user do not have a quota yet. Put in a default quota
		database.Write("quota",username + "/quota", defaultQuota)
	}
	
	//Load the user storage quota from database
	thisUserQuotaManager := QuotaHandler{
		database: database,
		username: username,
		fspool: fsh,
		TotalStorageQuota: totalQuota,
		UsedStorageQuota: 0,
	}

	thisUserQuotaManager.CalculateQuotaUsage();
	return &thisUserQuotaManager
}

//Set and Get the user storage quota
func (q *QuotaHandler)SetUserStorageQuota(quota int64){
	q.database.Write("quota",q.username + "/quota", quota)
	q.TotalStorageQuota = quota;
}

func (q *QuotaHandler)GetUserStorageQuota() int64{
	quota := int64(-2)
	q.database.Read("quota",q.username + "/quota", &quota)
	//Also update the one in memory
	q.TotalStorageQuota = quota;
	return quota
}

func (q *QuotaHandler)RemoveUserQuota(){
	q.database.Delete("quota", q.username + "/quota")
}

func (q *QuotaHandler)HaveSpace(size int64) bool{
	remaining := q.TotalStorageQuota - q.UsedStorageQuota;
	if q.TotalStorageQuota == -1{
		return true
	}
	if (size < remaining){
		return true
	}else{
		return false
	}
	return false
}

//Update the user's storage pool to new one
func (q *QuotaHandler)UpdateUserStoragePool(fsh []*fs.FileSystemHandler){
	q.fspool = fsh;
}

//Claim a space for the given file and set the file ownership to this user
func (q *QuotaHandler)AllocateSpace(filesize int64) error{
	q.UsedStorageQuota += filesize;
	return nil
} 

//Reclaim file occupied space (Call this before removing it)
func (q *QuotaHandler)ReclaimSpace(filesize int64) error{
	q.UsedStorageQuota -= filesize;
	if q.UsedStorageQuota < 0{
		q.UsedStorageQuota = 0;
	}
	return nil
}

func (q *QuotaHandler)CalculateQuotaUsage(){
	totalUsedVolume := int64(0)
	for _, thisfs := range q.fspool{
		if (thisfs.Hierarchy == "user"){
			err := filepath.Walk(filepath.ToSlash(filepath.Clean(thisfs.Path)) + "/users/" + q.username, func(path string, info os.FileInfo, err error) error {
				if !info.IsDir() {
					totalUsedVolume += fs.GetFileSize(path)
				}
				return nil
			})
			if err != nil{
				continue
			}
		}
	}

	q.UsedStorageQuota = totalUsedVolume;
}

func inSlice(slice []string, val string) (int, bool) {
    for i, item := range slice {
        if item == val {
            return i, true
        }
    }
    return -1, false
}
