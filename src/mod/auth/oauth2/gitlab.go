package oauth2

import (
	"encoding/json"
	"io/ioutil"
	"net/http"
	"net/url"
	"time"

	"golang.org/x/oauth2"
)

type GitlabField struct {
	ID                             int           `json:"id"`
	Name                           string        `json:"name"`
	Username                       string        `json:"username"`
	State                          string        `json:"state"`
	AvatarURL                      string        `json:"avatar_url"`
	WebURL                         string        `json:"web_url"`
	CreatedAt                      time.Time     `json:"created_at"`
	Bio                            string        `json:"bio"`
	BioHTML                        string        `json:"bio_html"`
	Location                       interface{}   `json:"location"`
	PublicEmail                    string        `json:"public_email"`
	Skype                          string        `json:"skype"`
	Linkedin                       string        `json:"linkedin"`
	Twitter                        string        `json:"twitter"`
	WebsiteURL                     string        `json:"website_url"`
	Organization                   interface{}   `json:"organization"`
	JobTitle                       string        `json:"job_title"`
	Pronouns                       interface{}   `json:"pronouns"`
	Bot                            bool          `json:"bot"`
	WorkInformation                interface{}   `json:"work_information"`
	Followers                      int           `json:"followers"`
	Following                      int           `json:"following"`
	LastSignInAt                   time.Time     `json:"last_sign_in_at"`
	ConfirmedAt                    time.Time     `json:"confirmed_at"`
	LastActivityOn                 string        `json:"last_activity_on"`
	Email                          string        `json:"email"`
	ThemeID                        int           `json:"theme_id"`
	ColorSchemeID                  int           `json:"color_scheme_id"`
	ProjectsLimit                  int           `json:"projects_limit"`
	CurrentSignInAt                time.Time     `json:"current_sign_in_at"`
	Identities                     []interface{} `json:"identities"`
	CanCreateGroup                 bool          `json:"can_create_group"`
	CanCreateProject               bool          `json:"can_create_project"`
	TwoFactorEnabled               bool          `json:"two_factor_enabled"`
	External                       bool          `json:"external"`
	PrivateProfile                 bool          `json:"private_profile"`
	CommitEmail                    string        `json:"commit_email"`
	SharedRunnersMinutesLimit      interface{}   `json:"shared_runners_minutes_limit"`
	ExtraSharedRunnersMinutesLimit interface{}   `json:"extra_shared_runners_minutes_limit"`
	IsAdmin                        bool          `json:"is_admin"`
	Note                           interface{}   `json:"note"`
	UsingLicenseSeat               bool          `json:"using_license_seat"`
}

func gitlabScope() []string {
	return []string{"read_user api read_api"}
}

func gitlabEndpoint(server string) oauth2.Endpoint {
	Endpoint := oauth2.Endpoint{
		AuthURL:  server + "/oauth/authorize",
		TokenURL: server + "/oauth/token",
	}
	return Endpoint
}

func gitlabUserInfo(accessToken string, server string) (string, error) {
	response, err := http.Get(server + "/api/v4/user?access_token=" + accessToken)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	contents, err := ioutil.ReadAll(response.Body)
	if err != nil {
		return "", err
	}
	var data GitlabField
	json.Unmarshal([]byte(contents), &data)

	serverURL, err := url.Parse(server)
	if err != nil {
		return "", err
	}
	return data.Username + "@" + serverURL.Hostname(), err
}
