package oauth2

import (
	"encoding/json"
	"io/ioutil"
	"net/http"

	"golang.org/x/oauth2"
)

type MicrosoftField struct {
	Sub        string `json:"sub"`
	Name       string `json:"name"`
	GivenName  string `json:"given_name"`
	FamilyName string `json:"family_name"`
	Email      string `json:"email"`
	Picture    string `json:"picture"`
}

func microsoftScope() []string {
	return []string{"user.read openid email profile"}
}

func microsoftEndpoint() oauth2.Endpoint {
	return oauth2.Endpoint{
		AuthURL:  "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
		TokenURL: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
	}
}

func microsoftUserInfo(accessToken string) (string, error) {
	client := &http.Client{}
	req, err := http.NewRequest("GET", "https://graph.microsoft.com/oidc/userinfo", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	response, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	contents, err := ioutil.ReadAll(response.Body)
	var data MicrosoftField
	json.Unmarshal([]byte(contents), &data)

	return data.Email, err
}
