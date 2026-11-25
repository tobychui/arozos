package ldap

import "imuslab.com/arozos/mod/info/logger"
import db "imuslab.com/arozos/mod/database"

func readSingleConfig(key string, coredb *db.Database) (out0 string) {
	defer logger.Out1(logger.In2("auth/ldap", "readSingleConfig", "coredb", coredb, "!key", key), &out0)
	var value string
	err := coredb.Read("ldap", key, &value)
	if err != nil {
		logger.DebugErr("auth/ldap", err)
		value = ""
	}
	return value
}

func (ldap *ldapHandler) readSingleConfig(key string) (out0 string) {
	defer logger.Out1(logger.In2("auth/ldap", "ldapHandler.readSingleConfig", "ldap", ldap, "!key", key), &out0)
	var value string
	err := ldap.coredb.Read("ldap", key, &value)
	if err != nil {
		logger.DebugErr("auth/ldap", err)
		value = ""
	}
	return value
}
