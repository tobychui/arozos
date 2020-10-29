package main

import (
	"net/http"
	"encoding/json"
	"path/filepath"
	"os"
	"sort"
	"strings"
	"log"

	fs "imuslab.com/aroz_online/mod/filesystem"
	//user "imuslab.com/aroz_online/mod/user"
)

func DiskQuotaInit(){
	//Register Endpoints
	http.HandleFunc("/system/disk/quota/setQuota", system_disk_quota_setQuota)
	http.HandleFunc("/system/disk/quota/listQuota", system_disk_quota_listQuota)
	http.HandleFunc("/system/disk/quota/quotaInfo", system_disk_quota_handleQuotaInfo)
	http.HandleFunc("/system/disk/quota/quotaDist", system_disk_quota_handleFileDistributionView)

	//Register Setting Interfaces
	//Register interface fow viewing the user storage quota
	registerSetting(settingModule{
		Name:     "Storage Quota",
		Desc:     "User Remaining Space",
		IconPath: "SystemAO/disk/quota/img/small_icon.png",
		Group:    "Disk",
		StartDir: "SystemAO/disk/quota/quota.system",
	})

	//Register interface for admin to setup quota settings
	/*
	registerSetting(settingModule{
		Name:         "Quota Settings",
		Desc:         "Setup Group Storage Limit",
		IconPath:     "SystemAO/disk/quota/img/small_icon.png",
		Group:        "Disk",
		StartDir:     "SystemAO/disk/quota/manage.html",
		RequireAdmin: true,
	})
	*/
}


//Get a list of quota on user groups and their storage limit
func system_disk_quota_listQuota(w http.ResponseWriter, r *http.Request) {

}


//Set the storage quota of the particular user
func system_disk_quota_setQuota(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w,r)
	if err != nil{
		sendErrorResponse(w, "Unknown User");
		return
	}

	//Check if admin
	if !userinfo.IsAdmin(){
		sendErrorResponse(w, "Permission Denied");
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

	log.Println("Updating " + groupname + " to ", quotaSize, "WIP")
	sendOK(w);

}


func system_disk_quota_handleQuotaInfo(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w,r)
	if err != nil{
		sendErrorResponse(w, "Unknown User");
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
}

//Get all the users file and see how
func system_disk_quota_handleFileDistributionView(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w,r)
	if err != nil{
		sendErrorResponse(w, "Unknown User");
		return
	}

	fileDist := map[string]int64{}
	userFileSystemHandlers := userinfo.GetAllFileSystemHandler()
	for _, thisHandler := range userFileSystemHandlers {
		if (thisHandler.Hierarchy == "user"){
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

