package whitelist

import (
	"encoding/json"
	"net/http"
	"strings"

	"imuslab.com/arozos/mod/common"
	"imuslab.com/arozos/mod/network"
)

func (wl *WhiteList) HandleAddWhitelistedIP(w http.ResponseWriter, r *http.Request) {
	ipRange, err := common.Mv(r, "iprange", true)
	if err != nil {
		common.SendErrorResponse(w, "Invalid ip range given")
		return
	}

	err = wl.SetWhitelist(ipRange)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}

	common.SendOK(w)
}

func (wl *WhiteList) HandleRemoveWhitelistedIP(w http.ResponseWriter, r *http.Request) {
	ipRange, err := common.Mv(r, "iprange", true)
	if err != nil {
		common.SendErrorResponse(w, "Invalid ip range given")
		return
	}

	err = wl.UnsetWhitelist(ipRange)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}

	common.SendOK(w)
}

func (wl *WhiteList) HandleSetWhitelistEnable(w http.ResponseWriter, r *http.Request) {
	enableMode, _ := common.Mv(r, "enable", true)
	if enableMode == "" {
		//Get the current whitelist status
		js, _ := json.Marshal(wl.Enabled)
		common.SendJSONResponse(w, string(js))
		return
	} else {
		if strings.ToLower(enableMode) == "true" {
			wl.SetWhitelistEnabled(true)
			common.SendOK(w)
		} else if strings.ToLower(enableMode) == "false" {
			wl.SetWhitelistEnabled(false)
			common.SendOK(w)
		} else {
			common.SendErrorResponse(w, "Invalid mode given")
		}
	}
}

func (wl *WhiteList) HandleListWhitelistedIPs(w http.ResponseWriter, r *http.Request) {
	bannedIpRanges := wl.ListWhitelistedIpRanges()
	js, _ := json.Marshal(bannedIpRanges)
	common.SendJSONResponse(w, string(js))
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
