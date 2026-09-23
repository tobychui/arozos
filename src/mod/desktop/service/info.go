package service

import (
	"encoding/json"
	"net/http"

	"imuslab.com/arozos/mod/utils"
)

/*
	Host and user information shown on the desktop
*/

// publicUserInfo is what the desktop may learn about a user
type publicUserInfo struct {
	Username          string
	UserIcon          string
	UserGroups        []string
	IsAdmin           bool
	StorageQuotaTotal int64
	StorageQuotaLeft  int64
}

func (s *Service) handleHostInfo(w http.ResponseWriter, r *http.Request) {
	info := HostInfo{}
	if s.opts.HostInfo != nil {
		info = s.opts.HostInfo()
	}
	jsonString, _ := json.Marshal(info)
	utils.SendJSONResponse(w, string(jsonString))
}

// handleUserInfo returns the current user's info, or the public info of the user named by "target"
func (s *Service) handleUserInfo(w http.ResponseWriter, r *http.Request) {
	userinfo, err := s.opts.Users.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Another user's public info (name, icon, admin flag) only
	targetUser, err := utils.GetPara(r, "target")
	if err == nil {
		searchingUser, err := s.opts.Users.GetUserInfoFromUsername(targetUser)
		if err != nil {
			utils.SendErrorResponse(w, "User not found")
			return
		}
		js, _ := json.Marshal(publicUserInfo{
			Username: searchingUser.Username,
			UserIcon: searchingUser.GetUserIcon(),
			IsAdmin:  searchingUser.IsAdmin(),
		})
		utils.SendJSONResponse(w, string(js))
		return
	}

	remainingQuota := userinfo.StorageQuota.TotalStorageQuota - userinfo.StorageQuota.UsedStorageQuota
	if userinfo.StorageQuota.TotalStorageQuota == -1 {
		remainingQuota = -1
	}

	pgs := []string{}
	for _, pg := range userinfo.GetUserPermissionGroup() {
		pgs = append(pgs, pg.Name)
	}

	rs := publicUserInfo{
		Username:          userinfo.Username,
		IsAdmin:           userinfo.IsAdmin(),
		UserGroups:        pgs,
		StorageQuotaTotal: userinfo.StorageQuota.GetUserStorageQuota(),
		StorageQuotaLeft:  remainingQuota,
	}

	//Skip the icon when the client does not need it
	nic, _ := utils.PostPara(r, "noicon")
	if nic != "true" {
		rs.UserIcon = userinfo.GetUserIcon()
	}

	jsonString, _ := json.Marshal(rs)
	utils.SendJSONResponse(w, string(jsonString))
}
