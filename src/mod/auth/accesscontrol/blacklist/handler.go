package blacklist

import (
	"encoding/json"
	"net/http"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/network"
	"imuslab.com/arozos/mod/utils"
)

/*
	Handler for blacklist module

*/

func (bl *BlackList) HandleAddBannedIP(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("auth/accesscontrol/blacklist", "BlackList.HandleAddBannedIP", "bl", bl, "r", r))
	ipRange, err := utils.PostPara(r, "iprange")
	if err != nil {
		logger.DebugErr("auth/accesscontrol/blacklist", err)
		utils.SendErrorResponse(w, "Invalid ip range given")
		return
	}

	err = bl.Ban(ipRange)
	if err != nil {
		logger.DebugErr("auth/accesscontrol/blacklist", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)
}

func (bl *BlackList) HandleRemoveBannedIP(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("auth/accesscontrol/blacklist", "BlackList.HandleRemoveBannedIP", "bl", bl, "r", r))
	ipRange, err := utils.PostPara(r, "iprange")
	if err != nil {
		logger.DebugErr("auth/accesscontrol/blacklist", err)
		utils.SendErrorResponse(w, "Invalid ip range given")
		return
	}

	err = bl.UnBan(ipRange)
	if err != nil {
		logger.DebugErr("auth/accesscontrol/blacklist", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)
}

func (bl *BlackList) HandleSetBlacklistEnable(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("auth/accesscontrol/blacklist", "BlackList.HandleSetBlacklistEnable", "bl", bl, "r", r))
	enableMode, _ := utils.PostPara(r, "enable")
	if enableMode == "" {
		//Get the current blacklist status
		js, _ := json.Marshal(bl.Enabled)
		utils.SendJSONResponse(w, string(js))
		return
	} else {
		if strings.ToLower(enableMode) == "true" {
			bl.SetBlacklistEnabled(true)
			utils.SendOK(w)
		} else if strings.ToLower(enableMode) == "false" {
			bl.SetBlacklistEnabled(false)
			utils.SendOK(w)
		} else {
			utils.SendErrorResponse(w, "Invalid mode given")
		}
	}
}
func (bl *BlackList) SetBlacklistEnabled(enabled bool) {
	defer logger.Out0(logger.In2("auth/accesscontrol/blacklist", "BlackList.SetBlacklistEnabled", "bl", bl, "enabled", enabled))
	if enabled {
		bl.Enabled = true
		bl.database.Write("ipblacklist", "enable", true)
	} else {
		bl.Enabled = false
		bl.database.Write("ipblacklist", "enable", false)
	}
}

func (bl *BlackList) HandleListBannedIPs(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("auth/accesscontrol/blacklist", "BlackList.HandleListBannedIPs", "bl", bl, "r", r))
	bannedIpRanges := bl.ListBannedIpRanges()
	js, _ := json.Marshal(bannedIpRanges)
	utils.SendJSONResponse(w, string(js))
}

func (bl *BlackList) CheckIsBannedByRequest(r *http.Request) (out0 bool) {
	defer logger.Out1(logger.In2("auth/accesscontrol/blacklist", "BlackList.CheckIsBannedByRequest", "bl", bl, "r", r), &out0)
	if bl.Enabled == false {
		//Blacklist not enabled. Always return not banned
		return false
	}
	//Get the IP address from the request header
	requestIP, err := network.GetIpFromRequest(r)
	if err != nil {
		logger.DebugErr("auth/accesscontrol/blacklist", err)
		return false
	}

	return bl.IsBanned(requestIP)
}
