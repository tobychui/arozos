package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	fs "imuslab.com/arozos/mod/filesystem"
	//user "imuslab.com/arozos/mod/user"
)

func DiskQuotaInit() {
	//Register Endpoints
	http.HandleFunc("/system/disk/quota/setQuota", system_disk_quota_setQuota)
	http.HandleFunc("/system/disk/quota/quotaInfo", system_disk_quota_handleQuotaInfo)
	http.HandleFunc("/system/disk/quota/quotaDist", system_disk_quota_handleFileDistributionView)

	//Register Setting Interfaces
	registerSetting(settingModule{
		Name:     "Storage Quota",
		Desc:     "User Remaining Space",
		IconPath: "SystemAO/disk/quota/img/small_icon.png",
		Group:    "Disk",
		StartDir: "SystemAO/disk/quota/quota.system",
	})

	//Register the timer for running the global user quota recalculation
	nightlyManager.RegisterNightlyTask(system_disk_quota_updateAllUserQuotaEstimation)
}

//Register the handler for automatically updating all user storage quota
func system_disk_quota_updateAllUserQuotaEstimation() {
	registeredUsers := authAgent.ListUsers()
	for _, username := range registeredUsers {
		//For each user, update their current quota usage
		userinfo, _ := userHandler.GetUserInfoFromUsername(username)
		userinfo.StorageQuota.CalculateQuotaUsage()
	}
}

//Set the storage quota of the particular user
func system_disk_quota_setQuota(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "Unknown User")
		return
	}

	//Check if admin
	if !userinfo.IsAdmin() {
		sendErrorResponse(w, "Permission Denied")
		return
	}

	groupname, err := mv(r, "groupname", true)
	if err != nil {
		sendErrorResponse(w, "Group name not defned")
		return
	}

	quotaSizeString, err := mv(r, "quota", true)
	if err != nil {
		sendErrorResponse(w, "Quota not defined")
		return
	}

	quotaSize, err := StringToInt64(quotaSizeString)
	if err != nil || quotaSize < 0 {
		sendErrorResponse(w, "Invalid quota size given")
		return
	}
	//Qutasize unit is in MB
	quotaSize = quotaSize << 20

	log.Println("Updating "+groupname+" to ", quotaSize, "WIP")
	sendOK(w)

}

func system_disk_quota_handleQuotaInfo(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "Unknown User")
		return
	}

	//Get quota information
	type quotaInformation struct {
		Remaining int64
		Used      int64
		Total     int64
	}

	jsonString, _ := json.Marshal(quotaInformation{
		Remaining: userinfo.StorageQuota.TotalStorageQuota - userinfo.StorageQuota.UsedStorageQuota,
		Used:      userinfo.StorageQuota.UsedStorageQuota,
		Total:     userinfo.StorageQuota.TotalStorageQuota,
	})

	sendJSONResponse(w, string(jsonString))

	go func() {
		//Update this user's quota estimation in go routine
		userinfo.StorageQuota.CalculateQuotaUsage()
	}()
}

//Get all the users file and see how
func system_disk_quota_handleFileDistributionView(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "Unknown User")
		return
	}

	fileDist := map[string]int64{}
	userFileSystemHandlers := userinfo.GetAllFileSystemHandler()
	for _, thisHandler := range userFileSystemHandlers {
		if thisHandler.Hierarchy == "user" {
			thispath := filepath.ToSlash(filepath.Clean(thisHandler.Path)) + "/users/" + userinfo.Username + "/"
			filepath.Walk(thispath, func(filepath string, info os.FileInfo, err error) error {
				if err != nil {
					return err
				}
				if !info.IsDir() {
					mime, _, err := fs.GetMime(filepath)
					if err != nil {
						return err
					}
					mediaType := strings.SplitN(mime, "/", 2)[0]
					mediaType = strings.Title(mediaType)
					fileDist[mediaType] = fileDist[mediaType] + info.Size()
				}
				return err
			})
		}
	}

	//Sort the file according to the number of files in the
	type kv struct {
		Mime string
		Size int64
	}

	var ss []kv
	for k, v := range fileDist {
		ss = append(ss, kv{k, v})
	}

	sort.Slice(ss, func(i, j int) bool {
		return ss[i].Size > ss[j].Size
	})

	//Return the distrubution using json string
	jsonString, _ := json.Marshal(ss)
	sendJSONResponse(w, string(jsonString))
}
