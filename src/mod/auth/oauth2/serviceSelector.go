package oauth2

import (
	"errors"

	"golang.org/x/oauth2"
	db "imuslab.com/arozos/mod/database"
)

// GetProviders returns the ordered list of supported OAuth2 providers.
// "Custom" lets administrators configure any OIDC-compatible provider.
func GetProviders() []string {
	return []string{"Google", "Microsoft", "Github", "Gitlab", "Custom"}
}

// getScope returns the OAuth2 scopes for the currently configured provider.
func getScope(coredb *db.Database) []string {
	idp := readSingleConfig("idp", coredb)
	switch idp {
	case "Google":
		return googleScope()
	case "Github":
		return githubScope()
	case "Microsoft":
		return microsoftScope()
	case "Gitlab":
		return gitlabScope()
	case "Custom":
		// Custom scope stored by the administrator; fall back to a sensible default.
		scope := readSingleConfig("customscope", coredb)
		if scope == "" {
			scope = "openid email profile"
		}
		return []string{scope}
	}
	return []string{}
}

// getEndpoint returns the OAuth2 endpoints for the currently configured provider.
func getEndpoint(coredb *db.Database) oauth2.Endpoint {
	idp := readSingleConfig("idp", coredb)
	switch idp {
	case "Google":
		return googleEndpoint()
	case "Github":
		return githubEndpoint()
	case "Microsoft":
		return microsoftEndpoint()
	case "Gitlab":
		return gitlabEndpoint(readSingleConfig("serverurl", coredb))
	case "Custom":
		return oauth2.Endpoint{
			AuthURL:  readSingleConfig("authurl", coredb),
			TokenURL: readSingleConfig("tokenurl", coredb),
		}
	}
	return oauth2.Endpoint{}
}

// getUserInfo retrieves the username/email from the provider using the access token.
func getUserInfo(accessToken string, coredb *db.Database) (string, error) {
	idp := readSingleConfig("idp", coredb)
	switch idp {
	case "Google":
		return googleUserInfo(accessToken)
	case "Github":
		return githubUserInfo(accessToken)
	case "Microsoft":
		return microsoftUserInfo(accessToken)
	case "Gitlab":
		return gitlabUserInfo(accessToken, readSingleConfig("serverurl", coredb))
	case "Custom":
		return customUserInfo(
			accessToken,
			readSingleConfig("userinfourl", coredb),
			readSingleConfig("userfield", coredb),
		)
	}
	return "", errors.New("Unauthorized")
}
