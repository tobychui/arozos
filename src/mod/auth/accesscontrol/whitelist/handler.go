package whitelist

import (
	"encoding/json"
	"net/http"
	"strings"

	"imuslab.com/arozos/mod/network"
	"imuslab.com/arozos/mod/utils"
)

func (wl *WhiteList) HandleAddWhitelistedIP(w http.ResponseWriter, r *http.Request) {
	ipRange, err := utils.PostPara(r, "iprange")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid ip range given")
		return
	}

	err = wl.SetWhitelist(ipRange)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)
}

func (wl *WhiteList) HandleRemoveWhitelistedIP(w http.ResponseWriter, r *http.Request) {
	ipRange, err := utils.PostPara(r, "iprange")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid ip range given")
		return
	}

	err = wl.UnsetWhitelist(ipRange)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)
}

func (wl *WhiteList) HandleSetWhitelistEnable(w http.ResponseWriter, r *http.Request) {
	enableMode, _ := utils.PostPara(r, "enable")
	if enableMode == "" {
		//Get the current whitelist status
		js, _ := json.Marshal(wl.Enabled)
		utils.SendJSONResponse(w, string(js))
		return
	} else {
		if strings.ToLower(enableMode) == "true" {
			wl.SetWhitelistEnabled(true)
			utils.SendOK(w)
		} else if strings.ToLower(enableMode) == "false" {
			wl.SetWhitelistEnabled(false)
			utils.SendOK(w)
		} else {
			utils.SendErrorResponse(w, "Invalid mode given")
		}
	}
}

func (wl *WhiteList) HandleListWhitelistedIPs(w http.ResponseWriter, r *http.Request) {
	bannedIpRanges := wl.ListWhitelistedIpRanges()
	js, _ := json.Marshal(bannedIpRanges)
	utils.SendJSONResponse(w, string(js))
}

func (wl *WhiteList) CheckIsWhitelistedByRequest(r *http.Request) bool {
	if wl.Enabled == false {
		//Whitelist not enabled. Always return is whitelisted
		return true
	}
	//Get the IP address from the request header
	requestIP, err := network.GetIpFromRequest(r)
	if err != nil {
		return false
	}

	return wl.IsWhitelisted(requestIP)
}
