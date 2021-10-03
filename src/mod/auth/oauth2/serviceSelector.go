package oauth2

import (
	"errors"

	"golang.org/x/oauth2"
	db "imuslab.com/arozos/mod/database"
)

//getScope use to select the correct scope
func getScope(coredb *db.Database) []string {
	idp := readSingleConfig("idp", coredb)
	if idp == "Google" {
		return googleScope()
	} else if idp == "Github" {
		return githubScope()
	} else if idp == "Microsoft" {
		return microsoftScope()
	} else if idp == "Gitlab" {
		return gitlabScope()
	}
	return []string{}
}

//getEndpoint use to select the correct endpoint
func getEndpoint(coredb *db.Database) oauth2.Endpoint {
	idp := readSingleConfig("idp", coredb)
	if idp == "Google" {
		return googleEndpoint()
	} else if idp == "Github" {
		return githubEndpoint()
	} else if idp == "Microsoft" {
		return microsoftEndpoint()
	} else if idp == "Gitlab" {
		return gitlabEndpoint(readSingleConfig("serverurl", coredb))
	}
	return oauth2.Endpoint{}
}

//getUserinfo use to select the correct way to retrieve userinfo
func getUserInfo(accessToken string, coredb *db.Database) (string, error) {
	idp := readSingleConfig("idp", coredb)
	if idp == "Google" {
		return googleUserInfo(accessToken)
	} else if idp == "Github" {
		return githubUserInfo(accessToken)
	} else if idp == "Microsoft" {
		return microsoftUserInfo(accessToken)
	} else if idp == "Gitlab" {
		return gitlabUserInfo(accessToken, readSingleConfig("serverurl", coredb))
	}
	return "", errors.New("Unauthorized")
}
