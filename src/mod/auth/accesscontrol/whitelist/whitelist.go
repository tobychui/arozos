package whitelist

import (
	"errors"
	"log"
	"strings"

	"imuslab.com/arozos/mod/auth/accesscontrol"
	"imuslab.com/arozos/mod/database"
)

/*
	Whitelist

*/

type WhiteList struct {
	database *database.Database
	Enabled  bool
}

func NewWhitelistManager(sysdb *database.Database) *WhiteList {
	sysdb.NewTable("ipwhitelist")

	whitelistEnabled := false
	if sysdb.KeyExists("ipwhitelist", "enable") {
		err := sysdb.Read("ipwhitelist", "enable", &whitelistEnabled)
		if err != nil {
			log.Println("[Auth/Whitelist] Unable to load previous enable state from database. Using default.")
		}
	}

	return &WhiteList{
		database: sysdb,
		Enabled:  whitelistEnabled,
	}
}

func (wl *WhiteList) SetWhitelistEnabled(enable bool) {
	if enable {
		wl.Enabled = true
		wl.database.Write("ipwhitelist", "enable", true)
	} else {
		wl.Enabled = false
		wl.database.Write("ipwhitelist", "enable", false)
	}
}

func (wl *WhiteList) IsWhitelisted(ip string) bool {
	//Check if whitelist is enabled
	if wl.Enabled == false {
		return true
	}

	//Check if this is reserved IP address
	if ip == "127.0.0.1" || ip == "localhost" {
		return true
	}

	//Check if this particular ip is whitelisted
	if wl.database.KeyExists("ipwhitelist", ip) {
		return true
	}

	//The ip might be inside as a range. Do a range search.
	//Need optimization, current implementation is O(N)
	for _, thisIpRange := range wl.ListWhitelistedIpRanges() {
		if accesscontrol.IpInRange(ip, thisIpRange) {
			return true
		}
	}
	return false
}

func (wl *WhiteList) ListWhitelistedIpRanges() []string {
	entries, err := wl.database.ListTable("ipwhitelist")
	if err != nil {
		return []string{}
	}
	results := []string{"127.0.0.1"}
	for _, keypairs := range entries {
		thisIpRange := keypairs[0]
		if string(thisIpRange) == "enable" || accesscontrol.ValidateIpRange(string(thisIpRange)) != nil {
			//Reserved key field
			continue
		}
		results = append(results, string(thisIpRange))
	}
	return results
}

func (wl *WhiteList) SetWhitelist(ipRange string) error {
	//Check if the IP range is correct
	err := accesscontrol.ValidateIpRange(ipRange)
	if err != nil {
		return err
	}

	//Push it to the ban list
	ipRange = strings.TrimSpace(ipRange)
	ipRange = strings.ReplaceAll(ipRange, " ", "")
	return wl.database.Write("ipwhitelist", ipRange, true)
}

func (wl *WhiteList) UnsetWhitelist(ipRange string) error {
	//Check if the IP range is correct
	err := accesscontrol.ValidateIpRange(ipRange)
	if err != nil {
		return err
	}

	//Check if the ip range is banned
	if !wl.database.KeyExists("ipwhitelist", ipRange) {
		return errors.New("invalid IP range given")
	}

	//Ip range exists, remove it from database
	return wl.database.Delete("ipwhitelist", ipRange)
}
