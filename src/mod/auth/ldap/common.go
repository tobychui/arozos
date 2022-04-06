package ldap

import db "imuslab.com/arozos/mod/database"

func readSingleConfig(key string, coredb *db.Database) string {
	var value string
	err := coredb.Read("ldap", key, &value)
	if err != nil {
		value = ""
	}
	return value
}

func (ldap *ldapHandler) readSingleConfig(key string) string {
	var value string
	err := ldap.coredb.Read("ldap", key, &value)
	if err != nil {
		value = ""
	}
	return value
}
