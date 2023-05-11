package ldap

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/auth/ldap/ldapreader"
	"imuslab.com/arozos/mod/utils"
)

func (ldap *ldapHandler) ReadConfig(w http.ResponseWriter, r *http.Request) {
	//basic components
	enabled, err := strconv.ParseBool(ldap.readSingleConfig("enabled"))
	if err != nil {
		utils.SendTextResponse(w, "Invalid config value [key=enabled].")
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
			utils.SendErrorResponse(w, "Error while marshalling config")
		}
		utils.SendJSONResponse(w, string(empty))
	}
	utils.SendJSONResponse(w, string(config))
}

func (ldap *ldapHandler) WriteConfig(w http.ResponseWriter, r *http.Request) {
	//receive the parameter
	enabled, err := utils.PostPara(r, "enabled")
	if err != nil {
		utils.SendErrorResponse(w, "enabled field can't be empty")
		return
	}

	//allow empty fields if enabled is false
	showError := true
	if enabled != "true" {
		showError = false
	}

	//four fields to store the LDAP authentication information
	BindUsername, err := utils.PostPara(r, "bind_username")
	if err != nil {
		if showError {
			utils.SendErrorResponse(w, "bind_username field can't be empty")
			return
		}
	}
	BindPassword, err := utils.PostPara(r, "bind_password")
	if err != nil {
		if showError {
			utils.SendErrorResponse(w, "bind_password field can't be empty")
			return
		}
	}
	FQDN, err := utils.PostPara(r, "fqdn")
	if err != nil {
		if showError {
			utils.SendErrorResponse(w, "fqdn field can't be empty")
			return
		}
	}
	BaseDN, err := utils.PostPara(r, "base_dn")
	if err != nil {
		if showError {
			utils.SendErrorResponse(w, "base_dn field can't be empty")
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
	utils.SendOK(w)
}

func (ldap *ldapHandler) TestConnection(w http.ResponseWriter, r *http.Request) {
	//marshall it and return the connection status
	userList, totalLength, err := ldap.getAllUser(10)
	if err != nil {
		errMessage, err := json.Marshal(syncorizeUserReturnInterface{Error: err.Error()})
		if err != nil {
			utils.SendErrorResponse(w, "{\"error\":\"Error while marshalling information\"}")
			return
		}
		utils.SendJSONResponse(w, string(errMessage))
		return
	}
	returnJSON := syncorizeUserReturnInterface{Userinfo: userList, Length: len(userList), TotalLength: totalLength, Error: ""}
	accountJSON, err := json.Marshal(returnJSON)
	if err != nil {
		errMessage, err := json.Marshal(syncorizeUserReturnInterface{Error: err.Error()})
		if err != nil {
			utils.SendErrorResponse(w, "{\"error\":\"Error while marshalling information\"}")
			return
		}
		utils.SendJSONResponse(w, string(errMessage))
		return
	}
	utils.SendJSONResponse(w, string(accountJSON))
}

func (ldap *ldapHandler) checkCurrUserAdmin(w http.ResponseWriter, r *http.Request) (bool, error) {
	//check current user is admin and new update will remove it or not
	currentLoggedInUser, err := ldap.userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		return false, err
	}
	ldapCurrUserInfo, err := ldap.ldapreader.GetUser(currentLoggedInUser.Username)
	if err != nil {
		return false, errors.New(err.Error() + ", probably due to your account is not in the LDAP server")
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
	return isAdmin, nil
}

func (ldap *ldapHandler) SynchronizeUser(w http.ResponseWriter, r *http.Request) {
	//check if suer is admin before executing the command
	//if user is admin then check if user will lost him/her's admin access
	consistencyCheck, err := ldap.checkCurrUserAdmin(w, r)
	if err != nil {
		// escape " symbol manually
		errorMsg := strings.ReplaceAll(err.Error(), "\"", "\\\"")
		utils.SendErrorResponse(w, errorMsg)
		return
	}
	if !consistencyCheck {
		utils.SendErrorResponse(w, "You will no longer become the admin after synchronizing, synchronize terminated")
		return
	}

	err = ldap.SynchronizeUserFromLDAP()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}
