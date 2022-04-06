package ldapreader

import (
	"fmt"
	"strings"

	"github.com/go-ldap/ldap"
)

type LdapReader struct {
	username string
	password string
	server   string
	basedn   string
}

//NewOauthHandler xxx
func NewLDAPReader(username string, password string, server string, basedn string) *LdapReader {

	LDAPHandler := LdapReader{
		username: username,
		password: password,
		server:   server,
		basedn:   basedn,
	}

	return &LDAPHandler
}

func (handler *LdapReader) GetUser(username string) (*ldap.Entry, error) {
	returnVal, err := handler.retrieveInformation("uid="+username+","+handler.basedn, "(objectClass=person)", ldap.ScopeBaseObject, handler.username, handler.password)
	if err != nil {
		return nil, err
	}
	if len(returnVal) == 0 {
		return nil, fmt.Errorf("nothing found for user %s", username)
	}
	return returnVal[0], nil
}

func (handler *LdapReader) GetAllUser() ([]*ldap.Entry, error) {
	return handler.retrieveInformation(handler.basedn, "(objectClass=person)", ldap.ScopeWholeSubtree, handler.username, handler.password)
}

func (handler *LdapReader) Authenticate(username string, password string) (bool, error) {
	userInformation, err := handler.retrieveInformation("uid="+username+","+handler.basedn, "(objectClass=person)", ldap.ScopeBaseObject, "uid="+username+","+handler.basedn, password)
	if err != nil {
		if strings.Contains(err.Error(), "LDAP Result Code 32") {
			return false, nil
		}
		if strings.Contains(err.Error(), "LDAP Result Code 53") {
			return false, nil
		}
		if strings.Contains(err.Error(), "Couldn't fetch search entries") {
			return false, nil
		}
		return false, err
	}
	if len(userInformation) > 0 {
		if userInformation[0].GetAttributeValue("cn") == username {
			return true, nil
		}
	}
	return false, nil
}

func (handler *LdapReader) retrieveInformation(dn string, filter string, typeOfSearch int, username string, password string) ([]*ldap.Entry, error) {
	ldapURL, err := ldap.DialURL(fmt.Sprintf("ldap://%s:389", handler.server))
	if err != nil {
		return nil, err
	}
	defer ldapURL.Close()

	ldapURL.Bind(username, password)
	searchReq := ldap.NewSearchRequest(
		dn,
		typeOfSearch,
		ldap.NeverDerefAliases,
		0,
		0,
		false,
		filter,
		[]string{"uid", "memberOf", "cn", "sAMAccountName"},
		//[]string{},
		nil,
	)
	result, err := ldapURL.Search(searchReq)
	/*
		if err == nil {
			result.PrettyPrint(4)
		}
	*/
	if err != nil {
		return nil, fmt.Errorf("Search Error: %s", err)
	}

	if len(result.Entries) > 0 {
		return result.Entries, nil
	} else {
		return nil, fmt.Errorf("Couldn't fetch search entries")
	}
}
