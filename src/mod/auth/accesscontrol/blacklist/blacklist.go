package blacklist

import (
	"errors"
	"strings"

	"imuslab.com/arozos/mod/auth/accesscontrol"
	db "imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/info/logger"
)

/*

	ArozOS Blacklist Module
	Author: tobychui

	This module record the IP blacklist of users trying to enter the
	system without permission

*/

type BlackList struct {
	Enabled  bool
	database *db.Database
}

func NewBlacklistManager(sysdb *db.Database) *BlackList {
	logger.Debug("auth/accesscontrol/blacklist", "NewBlacklistManager")
	sysdb.NewTable("ipblacklist")

	blacklistEnabled := false
	if sysdb.KeyExists("ipblacklist", "enable") {
		err := sysdb.Read("ipblacklist", "enable", &blacklistEnabled)
		if err != nil {
			logger.PrintAndLog("Blacklist", "[Auth/Blacklist] Unable to load previous enable state from database. Using default.", nil)
		}
	}

	return &BlackList{
		Enabled:  blacklistEnabled,
		database: sysdb,
	}
}

// Check if a given IP is banned
func (bl *BlackList) IsBanned(ip string) bool {
	if logger.IsDebug() {
		logger.Debugf("auth/accesscontrol/blacklist", "BlackList.IsBanned: ip=%.120q", ip)
	}
	if bl.Enabled == false {
		return false
	}
	if bl.database.KeyExists("ipblacklist", ip) {
		return true
	}

	//The ip might be inside as a range. Do a range search.
	//Need optimization, current implementation is O(N)
	for _, thisIpRange := range bl.ListBannedIpRanges() {
		if accesscontrol.IpInRange(ip, thisIpRange) {
			return true
		}
	}
	return false
}

func (bl *BlackList) ListBannedIpRanges() []string {
	logger.Debug("auth/accesscontrol/blacklist", "BlackList.ListBannedIpRanges")
	entries, err := bl.database.ListTable("ipblacklist")
	if err != nil {
		return []string{}
	}
	results := []string{}
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

// Set the ban state of a ip or ip range
func (bl *BlackList) Ban(ipRange string) error {
	if logger.IsDebug() {
		logger.Debugf("auth/accesscontrol/blacklist", "BlackList.Ban: ipRange=%.120q", ipRange)
	}
	//Check if the IP range is correct
	err := accesscontrol.ValidateIpRange(ipRange)
	if err != nil {
		return err
	}

	//Push it to the ban list
	ipRange = strings.TrimSpace(ipRange)
	ipRange = strings.ReplaceAll(ipRange, " ", "")
	return bl.database.Write("ipblacklist", ipRange, true)
}

// Unban an IP or IP range
func (bl *BlackList) UnBan(ipRange string) error {
	if logger.IsDebug() {
		logger.Debugf("auth/accesscontrol/blacklist", "BlackList.UnBan: ipRange=%.120q", ipRange)
	}
	//Check if the IP range is correct
	err := accesscontrol.ValidateIpRange(ipRange)
	if err != nil {
		return err
	}

	//Check if the ip range is banned
	if !bl.database.KeyExists("ipblacklist", ipRange) {
		return errors.New("invalid IP range given")
	}

	//Ip range exists, remove it from database
	return bl.database.Delete("ipblacklist", ipRange)
}
