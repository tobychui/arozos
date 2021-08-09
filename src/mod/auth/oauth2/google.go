package oauth2

import (
	"encoding/json"
	"io/ioutil"
	"net/http"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

type GoogleField struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	VerifiedEmail bool   `json:"verified_email"`
	Name          string `json:"name"`
	GivenName     string `json:"given_name"`
	FamilyName    string `json:"family_name"`
	Picture       string `json:"picture"`
	Locale        string `json:"locale"`
}

func googleScope() []string {
	return []string{"https://www.googleapis.com/auth/userinfo.profile",
		"https://www.googleapis.com/auth/userinfo.email"}
}

func googleEndpoint() oauth2.Endpoint {
	return google.Endpoint
}

func googleUserInfo(accessToken string) (string, error) {
	response, err := http.Get("https://www.googleapis.com/oauth2/v2/userinfo?access_token=" + accessToken)

	defer response.Body.Close()
	contents, err := ioutil.ReadAll(response.Body)
	var data GoogleField
	json.Unmarshal([]byte(contents), &data)

	return data.Email, err
}
