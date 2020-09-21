package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	//"log"
)

/*
	Disk Quota Management System
	This module manage the user groups disk quota in the system

	Disk quota can only be set on a user group bases.
	(aka all users in the same group has the identical number of disk quota to the group settings)
*/

func system_disk_quota_init() {
	//Initiate quota storage table
	err := system_db_newTable(sysdb, "diskquota")
	if err != nil {
		panic(err)
	}

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
	registerSetting(settingModule{
		Name:         "Quota Settings",
		Desc:         "Setup Group Storage Limit",
		IconPath:     "SystemAO/disk/quota/img/small_icon.png",
		Group:        "Disk",
		StartDir:     "SystemAO/disk/quota/manage.html",
		RequireAdmin: true,
	})

}

//Get a list of quota on user groups and their storage limit
func system_disk_quota_listQuota(w http.ResponseWriter, r *http.Request) {
	_, err := system_auth_getUserName(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}
	isAdmin := system_permission_checkUserIsAdmin(w, r)
	if !isAdmin {
		sendErrorResponse(w, "Permission denied")
		return
	}

	groups := system_permission_listGroup()
	results := map[string]int64{}
	for _, group := range groups {
		quota, _ := system_disk_quota_getQuotaFromGroupname(group)
		results[group] = quota
	}

	jsonString, _ := json.Marshal(results)
	sendJSONResponse(w, string(jsonString))
}

//Check the storage quota on this usergroup. Return -1 for unlimited quota and 0 if error
func system_disk_quota_getQuotaFromGroupname(groupname string) (int64, error) {
	//If administrator, always return -1
	if groupname == "administrator" {
		return -1, nil
	}
	//Check if group exists
	if !system_permission_groupExists(groupname) {
		return 0, errors.New("Group not exists")
	}

	//Group exists. Get the group quota from db
	groupQuota := int64(0)
	err := system_db_read(sysdb, "diskquota", "quota/"+groupname, &groupQuota)
	if err != nil {
		return 0, err
	}
	return groupQuota, nil
}

//Check if the given size can fit into the user remaining quota
func system_disk_quota_validateQuota(username string, filesize int64) bool {
	return false
}

//Set the storage quota of the particular user
func system_disk_quota_setQuota(w http.ResponseWriter, r *http.Request) {
	authed := system_auth_chkauth(w, r)
	if !authed {
		sendErrorResponse(w, "User not logged in")
		return
	}
	isAdmin := system_permission_checkUserIsAdmin(w, r)
	if !isAdmin {
		sendErrorResponse(w, "Permission denied")
		return
	}

	//OK to proceed
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

	//Check groupname exists
	if !system_permission_groupExists(groupname) {
		sendErrorResponse(w, "Group name not exists. Given "+groupname)
		return
	}

	//Ok to proceed.
	err = system_db_write(sysdb, "diskquota", "quota/"+groupname, quotaSize)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	sendOK(w)
}

//Show the current user's quota information
func system_disk_quota_handleQuotaInfo(w http.ResponseWriter, r *http.Request) {
	username, err := system_auth_getUserName(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	remainingSpace, usedSpace, totalSpace, err := system_disk_quota_quotaInfo(username)
	type quotaInformation struct {
		Remaining int64
		Used      int64
		Total     int64
	}

	jsonString, _ := json.Marshal(quotaInformation{
		Remaining: remainingSpace,
		Used:      usedSpace,
		Total:     totalSpace,
	})

	sendJSONResponse(w, string(jsonString))

}

//Get all the users file and see how
func system_disk_quota_handleFileDistributionView(w http.ResponseWriter, r *http.Request) {
	//Check if the user logged in
	username, err := system_auth_getUserName(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	//Create a file distribution list
	fileDist := map[string]int64{}
	userpaths := system_storage_getUserDirectory(username)
	for _, thispath := range userpaths {
		filepath.Walk(thispath, func(filepath string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if !info.IsDir() {
				mime, _, err := system_fs_getMime(filepath)
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

//Get the quota information of the current user. Return the followings
/*
	Remaining space of the user quota (int64)
	Used space of the user quota (int64)
	Total theoretical space of the user quota (int64)
	Error (error). Standard error message if something goes wrong
*/
func system_disk_quota_quotaInfo(username string) (int64, int64, int64, error) {
	//Get the user group information
	usergroup := system_permission_getUserPermissionGroup(username)
	groupExists := system_permission_groupExists(usergroup)
	if !groupExists {
		return 0, 0, 0, errors.New("User group not exists")
	}

	//Get the group quota information
	groupQuota := int64(-1)
	system_db_read(sysdb, "diskquota", "quota/"+usergroup, &groupQuota)

	//Calculate user limit
	userpaths := system_storage_getUserDirectory(username)
	totalUserUsedSpace := int64(0)
	for _, thispath := range userpaths {
		filepath.Walk(thispath, func(_ string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if !info.IsDir() {
				totalUserUsedSpace += info.Size()
			}
			return err
		})
	}

	remainingSpace := groupQuota - totalUserUsedSpace
	if groupQuota == -1 {
		remainingSpace = -1
	}
	return remainingSpace, totalUserUsedSpace, groupQuota, nil
}
