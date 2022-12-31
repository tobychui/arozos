package blacklist

import (
	"encoding/json"
	"net/http"
	"strings"

	"imuslab.com/arozos/mod/network"
	"imuslab.com/arozos/mod/utils"
)

/*
	Handler for blacklist module

*/

func (bl *BlackList) HandleAddBannedIP(w http.ResponseWriter, r *http.Request) {
	ipRange, err := utils.PostPara(r, "iprange")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid ip range given")
		return
	}

	err = bl.Ban(ipRange)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)
}

func (bl *BlackList) HandleRemoveBannedIP(w http.ResponseWriter, r *http.Request) {
	ipRange, err := utils.PostPara(r, "iprange")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid ip range given")
		return
	}

	err = bl.UnBan(ipRange)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)
}

func (bl *BlackList) HandleSetBlacklistEnable(w http.ResponseWriter, r *http.Request) {
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
	if enabled {
		bl.Enabled = true
		bl.database.Write("ipblacklist", "enable", true)
	} else {
		bl.Enabled = false
		bl.database.Write("ipblacklist", "enable", false)
	}
}

func (bl *BlackList) HandleListBannedIPs(w http.ResponseWriter, r *http.Request) {
	bannedIpRanges := bl.ListBannedIpRanges()
	js, _ := json.Marshal(bannedIpRanges)
	utils.SendJSONResponse(w, string(js))
}

func (bl *BlackList) CheckIsBannedByRequest(r *http.Request) bool {
	if bl.Enabled == false {
		//Blacklist not enabled. Always return not banned
		return false
	}
	//Get the IP address from the request header
	requestIP, err := network.GetIpFromRequest(r)
	if err != nil {
		return false
	}

	return bl.IsBanned(requestIP)
}
