package blacklist

import (
	"encoding/json"
	"net/http"
	"strings"

	"imuslab.com/arozos/mod/common"
	"imuslab.com/arozos/mod/network"
)

/*
	Handler for blacklist module

*/

func (bl *BlackList) HandleAddBannedIP(w http.ResponseWriter, r *http.Request) {
	ipRange, err := common.Mv(r, "iprange", true)
	if err != nil {
		common.SendErrorResponse(w, "Invalid ip range given")
		return
	}

	err = bl.Ban(ipRange)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}

	common.SendOK(w)
}

func (bl *BlackList) HandleRemoveBannedIP(w http.ResponseWriter, r *http.Request) {
	ipRange, err := common.Mv(r, "iprange", true)
	if err != nil {
		common.SendErrorResponse(w, "Invalid ip range given")
		return
	}

	err = bl.UnBan(ipRange)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}

	common.SendOK(w)
}

func (bl *BlackList) HandleSetBlacklistEnable(w http.ResponseWriter, r *http.Request) {
	enableMode, _ := common.Mv(r, "enable", true)
	if enableMode == "" {
		//Get the current blacklist status
		js, _ := json.Marshal(bl.Enabled)
		common.SendJSONResponse(w, string(js))
		return
	} else {
		if strings.ToLower(enableMode) == "true" {
			bl.SetBlacklistEnabled(true)
			common.SendOK(w)
		} else if strings.ToLower(enableMode) == "false" {
			bl.SetBlacklistEnabled(false)
			common.SendOK(w)
		} else {
			common.SendErrorResponse(w, "Invalid mode given")
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
	common.SendJSONResponse(w, string(js))
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
