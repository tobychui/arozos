package oauth2

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

// customUserInfo fetches user info from a generic OpenID Connect / OAuth2 provider.
// userInfoURL is the provider's /userinfo endpoint.
// userField is the JSON key to use as the ArozOS username (defaults to "email").
func customUserInfo(accessToken string, userInfoURL string, userField string) (string, error) {
	if userInfoURL == "" {
		return "", errors.New("custom provider: user-info URL is not configured")
	}
	if userField == "" {
		userField = "email"
	}

	client := &http.Client{}
	req, err := http.NewRequest("GET", userInfoURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var data map[string]interface{}
	if err := json.Unmarshal(body, &data); err != nil {
		return "", errors.New("custom provider: failed to parse user-info response: " + err.Error())
	}

	val, ok := data[userField]
	if !ok {
		return "", errors.New("custom provider: field '" + userField + "' not found in user-info response")
	}
	username, ok := val.(string)
	if !ok {
		return "", errors.New("custom provider: field '" + userField + "' is not a string")
	}
	if username == "" {
		return "", errors.New("custom provider: field '" + userField + "' is empty")
	}
	return username, nil
}
