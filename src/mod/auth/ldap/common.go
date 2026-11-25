package ldap

import "imuslab.com/arozos/mod/info/logger"
import db "imuslab.com/arozos/mod/database"

func readSingleConfig(key string, coredb *db.Database) string {
	logger.Debug("auth/ldap", "readSingleConfig")
	var value string
	err := coredb.Read("ldap", key, &value)
	if err != nil {
		value = ""
	}
	return value
}

func (ldap *ldapHandler) readSingleConfig(key string) string {
	logger.Debug("auth/ldap", "ldapHandler.readSingleConfig")
	var value string
	err := ldap.coredb.Read("ldap", key, &value)
	if err != nil {
		value = ""
	}
	return value
}
