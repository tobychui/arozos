package ldap

import (
	"log"
	"regexp"

	"github.com/go-ldap/ldap"
	auth "imuslab.com/arozos/mod/auth"
	"imuslab.com/arozos/mod/auth/ldap/ldapreader"
	"imuslab.com/arozos/mod/auth/oauth2/syncdb"
	reg "imuslab.com/arozos/mod/auth/register"
	db "imuslab.com/arozos/mod/database"
	permission "imuslab.com/arozos/mod/permission"
	"imuslab.com/arozos/mod/time/nightly"
	"imuslab.com/arozos/mod/user"
)

type ldapHandler struct {
	ag                *auth.AuthAgent
	ldapreader        *ldapreader.LdapReader
	reg               *reg.RegisterHandler
	coredb            *db.Database
	permissionHandler *permission.PermissionHandler
	userHandler       *user.UserHandler
	iconSystem        string
	syncdb            *syncdb.SyncDB
	nightlyManager    *nightly.TaskManager
}

type Config struct {
	Enabled      bool   `json:"enabled"`
	BindUsername string `json:"bind_username"`
	BindPassword string `json:"bind_password"`
	FQDN         string `json:"fqdn"`
	BaseDN       string `json:"base_dn"`
}

type UserAccount struct {
	Username   string   `json:"username"`
	Group      []string `json:"group"`
	EquivGroup []string `json:"equiv_group"`
}

//syncorizeUserReturnInterface not designed to be used outside
type syncorizeUserReturnInterface struct {
	Userinfo    []UserAccount `json:"userinfo"`
	TotalLength int           `json:"total_length"`
	Length      int           `json:"length"`
	Error       string        `json:"error"`
}

//NewLdapHandler xxx
func NewLdapHandler(authAgent *auth.AuthAgent, register *reg.RegisterHandler, coreDb *db.Database, permissionHandler *permission.PermissionHandler, userHandler *user.UserHandler, nightlyManager *nightly.TaskManager, iconSystem string) *ldapHandler {
	//ldap handler init
	log.Println("Starting LDAP client...")
	err := coreDb.NewTable("ldap")
	if err != nil {
		log.Println("Failed to create LDAP database. Terminating.")
		panic(err)
	}

	//key value to be used for LDAP authentication
	BindUsername := readSingleConfig("BindUsername", coreDb)
	BindPassword := readSingleConfig("BindPassword", coreDb)
	FQDN := readSingleConfig("FQDN", coreDb)
	BaseDN := readSingleConfig("BaseDN", coreDb)

	LDAPHandler := ldapHandler{
		ag:                authAgent,
		ldapreader:        ldapreader.NewLDAPReader(BindUsername, BindPassword, FQDN, BaseDN),
		reg:               register,
		coredb:            coreDb,
		permissionHandler: permissionHandler,
		userHandler:       userHandler,
		iconSystem:        iconSystem,
		syncdb:            syncdb.NewSyncDB(),
		nightlyManager:    nightlyManager,
	}

	nightlyManager.RegisterNightlyTask(LDAPHandler.NightlySync)

	return &LDAPHandler
}

//@para limit: -1 means unlimited
func (ldap *ldapHandler) getAllUser(limit int) ([]UserAccount, int, error) {
	//read the user account from ldap, if limit is -1 then it will read all USERS
	var accounts []UserAccount
	result, err := ldap.ldapreader.GetAllUser()
	if err != nil {
		return []UserAccount{}, 0, err
	}
	//loop through the result
	for i, v := range result {
		account := ldap.convertGroup(v)
		accounts = append(accounts, account)
		if i+1 > limit && limit != -1 {
			break
		}
	}
	//check if the return struct is empty, if yes then insert empty
	if len(accounts) > 0 {
		return accounts[1:], len(result), nil
	} else {
		return []UserAccount{}, 0, nil
	}
}

func (ldap *ldapHandler) convertGroup(ldapUser *ldap.Entry) UserAccount {
	//check the group belongs
	var Group []string
	var EquivGroup []string
	regexSyntax := regexp.MustCompile("cn=([^,]+),")
	for _, v := range ldapUser.GetAttributeValues("memberOf") {
		groups := regexSyntax.FindStringSubmatch(v)
		if len(groups) > 0 {
			//check if the LDAP group is already exists in ArOZOS system
			if ldap.permissionHandler.GroupExists(groups[1]) {
				EquivGroup = append(EquivGroup, groups[1])
			}
			//LDAP list
			Group = append(Group, groups[1])
		}
	}
	if len(EquivGroup) < 1 {
		if !ldap.permissionHandler.GroupExists(ldap.reg.GetDefaultUserGroup()) {
			//create new user group named default, prventing user don't have a group
			ldap.permissionHandler.NewPermissionGroup("default", false, 15<<30, []string{}, "Desktop")
			ldap.reg.SetDefaultUserGroup("default")
		}
		EquivGroup = append(EquivGroup, ldap.reg.GetDefaultUserGroup())
	}
	account := UserAccount{
		Username:   ldapUser.GetAttributeValue("cn"),
		Group:      Group,
		EquivGroup: EquivGroup,
	}
	return account
}

func (ldap *ldapHandler) NightlySync() {
	checkLDAPenabled := ldap.readSingleConfig("enabled")
	if checkLDAPenabled == "true" {
		err := ldap.SynchronizeUserFromLDAP()
		if err != nil {
			log.Println(err)
		}
	}
}

func (ldap *ldapHandler) SynchronizeUserFromLDAP() error {
	//check if suer is admin before executing the command
	//if user is admin then check if user will lost him/her's admin access
	ldapUsersList, _, err := ldap.getAllUser(-1)
	if err != nil {
		return err
	}
	for _, ldapUser := range ldapUsersList {
		//check if user exist in system
		if ldap.ag.UserExists(ldapUser.Username) {
			//if exists, then check if the user group is the same with ldap's setting
			//Get the permission groups by their ids
			userinfo, err := ldap.userHandler.GetUserInfoFromUsername(ldapUser.Username)
			if err != nil {
				return err
			}
			newPermissionGroups := ldap.permissionHandler.GetPermissionGroupByNameList(ldapUser.EquivGroup)
			//Set the user's permission to these groups
			userinfo.SetUserPermissionGroup(newPermissionGroups)
		}
	}
	return nil
}
