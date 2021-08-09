package oauth2

import (
	"errors"

	"golang.org/x/oauth2"
	db "imuslab.com/arozos/mod/database"
)

func getScope(coredb *db.Database) []string {
	idp := readSingleConfig("idp", coredb)
	if idp == "Google" {
		return googleScope()
	} else if idp == "Github" {
		return githubScope()
	} else if idp == "Microsoft" {
		return microsoftScope()
	}
	return []string{}
}

func getEndpoint(coredb *db.Database) oauth2.Endpoint {
	idp := readSingleConfig("idp", coredb)
	if idp == "Google" {
		return googleEndpoint()
	} else if idp == "Github" {
		return githubEndpoint()
	} else if idp == "Microsoft" {
		return microsoftEndpoint()
	}
	return oauth2.Endpoint{}
}

func getUserInfo(accessToken string, coredb *db.Database) (string, error) {
	idp := readSingleConfig("idp", coredb)
	if idp == "Google" {
		return googleUserInfo(accessToken)
	} else if idp == "Github" {
		return githubUserInfo(accessToken)
	} else if idp == "Microsoft" {
		return microsoftUserInfo(accessToken)
	}
	return "", errors.New("Unauthorized")
}
