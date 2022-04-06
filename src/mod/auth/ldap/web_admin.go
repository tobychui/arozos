package ldap

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"

	"imuslab.com/arozos/mod/auth/ldap/ldapreader"
	"imuslab.com/arozos/mod/common"
)

func (ldap *ldapHandler) ReadConfig(w http.ResponseWriter, r *http.Request) {
	//basic components
	enabled, err := strconv.ParseBool(ldap.readSingleConfig("enabled"))
	if err != nil {
		common.SendTextResponse(w, "Invalid config value [key=enabled].")
		return
	}
	//get the LDAP config from db
	BindUsername := ldap.readSingleConfig("BindUsername")
	BindPassword := ldap.readSingleConfig("BindPassword")
	FQDN := ldap.readSingleConfig("FQDN")
	BaseDN := ldap.readSingleConfig("BaseDN")

	//marshall it and return
	config, err := json.Marshal(Config{
		Enabled:      enabled,
		BindUsername: BindUsername,
		BindPassword: BindPassword,
		FQDN:         FQDN,
		BaseDN:       BaseDN,
	})
	if err != nil {
		empty, err := json.Marshal(Config{})
		if err != nil {
			common.SendErrorResponse(w, "Error while marshalling config")
		}
		common.SendJSONResponse(w, string(empty))
	}
	common.SendJSONResponse(w, string(config))
}

func (ldap *ldapHandler) WriteConfig(w http.ResponseWriter, r *http.Request) {
	//receive the parameter
	enabled, err := common.Mv(r, "enabled", true)
	if err != nil {
		common.SendErrorResponse(w, "enabled field can't be empty")
		return
	}

	//allow empty fields if enabled is false
	showError := true
	if enabled != "true" {
		showError = false
	}

	//four fields to store the LDAP authentication information
	BindUsername, err := common.Mv(r, "bind_username", true)
	if err != nil {
		if showError {
			common.SendErrorResponse(w, "bind_username field can't be empty")
			return
		}
	}
	BindPassword, err := common.Mv(r, "bind_password", true)
	if err != nil {
		if showError {
			common.SendErrorResponse(w, "bind_password field can't be empty")
			return
		}
	}
	FQDN, err := common.Mv(r, "fqdn", true)
	if err != nil {
		if showError {
			common.SendErrorResponse(w, "fqdn field can't be empty")
			return
		}
	}
	BaseDN, err := common.Mv(r, "base_dn", true)
	if err != nil {
		if showError {
			common.SendErrorResponse(w, "base_dn field can't be empty")
			return
		}
	}

	//write the data back to db
	ldap.coredb.Write("ldap", "enabled", enabled)
	ldap.coredb.Write("ldap", "BindUsername", BindUsername)
	ldap.coredb.Write("ldap", "BindPassword", BindPassword)
	ldap.coredb.Write("ldap", "FQDN", FQDN)
	ldap.coredb.Write("ldap", "BaseDN", BaseDN)

	//update the new authencation infromation
	ldap.ldapreader = ldapreader.NewLDAPReader(BindUsername, BindPassword, FQDN, BaseDN)

	//return ok
	common.SendOK(w)
}

func (ldap *ldapHandler) TestConnection(w http.ResponseWriter, r *http.Request) {
	//marshall it and return the connection status
	userList, totalLength, err := ldap.getAllUser(10)
	if err != nil {
		errMessage, err := json.Marshal(syncorizeUserReturnInterface{Error: err.Error()})
		if err != nil {
			common.SendErrorResponse(w, "{\"error\":\"Error while marshalling information\"}")
			return
		}
		common.SendJSONResponse(w, string(errMessage))
		return
	}
	returnJSON := syncorizeUserReturnInterface{Userinfo: userList, Length: len(userList), TotalLength: totalLength, Error: ""}
	accountJSON, err := json.Marshal(returnJSON)
	if err != nil {
		errMessage, err := json.Marshal(syncorizeUserReturnInterface{Error: err.Error()})
		if err != nil {
			common.SendErrorResponse(w, "{\"error\":\"Error while marshalling information\"}")
			return
		}
		common.SendJSONResponse(w, string(errMessage))
		return
	}
	common.SendJSONResponse(w, string(accountJSON))
}

func (ldap *ldapHandler) checkCurrUserAdmin(w http.ResponseWriter, r *http.Request) bool {
	//check current user is admin and new update will remove it or not
	currentLoggedInUser, err := ldap.userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, "Error while getting user info")
		return false
	}
	ldapCurrUserInfo, err := ldap.ldapreader.GetUser(currentLoggedInUser.Username)
	if err != nil {
		common.SendErrorResponse(w, "Error while getting user info from LDAP")
		return false
	}
	isAdmin := false
	//get the croups out from LDAP group list
	regexSyntax := regexp.MustCompile("cn=([^,]+),")
	for _, v := range ldapCurrUserInfo.GetAttributeValues("memberOf") {
		//loop through all memberOf's array
		groups := regexSyntax.FindStringSubmatch(v)
		//if after regex there is still groups exists
		if len(groups) > 0 {
			//check if the LDAP group is already exists in ArOZOS system
			if ldap.permissionHandler.GroupExists(groups[1]) {
				if ldap.permissionHandler.GetPermissionGroupByName(groups[1]).IsAdmin {
					isAdmin = true
				}
			}
		}
	}
	return isAdmin
}

func (ldap *ldapHandler) SynchronizeUser(w http.ResponseWriter, r *http.Request) {
	//check if suer is admin before executing the command
	//if user is admin then check if user will lost him/her's admin access
	consistencyCheck := ldap.checkCurrUserAdmin(w, r)
	if !consistencyCheck {
		common.SendErrorResponse(w, "You will no longer become the admin after synchronizing, synchronize terminated")
		return
	}

	err := ldap.SynchronizeUserFromLDAP()
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	common.SendOK(w)
}
