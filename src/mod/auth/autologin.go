package auth

import (
	"encoding/json"
	"errors"
	"io/ioutil"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/sessions"
	uuid "github.com/satori/go.uuid"
)

//Autologin token. This token will not expire until admin removal
type AutoLoginToken struct {
	Owner string
	Token string
}

func (a *AuthAgent) NewAutologinToken(username string) string {
	//Generate a new token
	newTokenUUID := uuid.NewV4().String() + "-" + strconv.Itoa(int(time.Now().Unix()))
	a.autoLoginTokens = append(a.autoLoginTokens, &AutoLoginToken{
		Owner: username,
		Token: newTokenUUID,
	})

	//Save the token to sysdb
	a.Database.Write("auth", "altoken/"+newTokenUUID, username)

	//Return the new token
	return newTokenUUID
}

func (a *AuthAgent) RemoveAutologinToken(token string) {
	newTokenArray := []*AutoLoginToken{}
	for _, alt := range a.autoLoginTokens {
		if alt.Token != token {
			newTokenArray = append(newTokenArray, alt)
		} else {
			//Delete this from the database
			a.Database.Delete("auth", "altoken/"+alt.Token)
		}
	}
	a.autoLoginTokens = newTokenArray
}

func (a *AuthAgent) RemoveAutologinTokenByUsername(username string) {
	newTokenArray := []*AutoLoginToken{}
	for _, alt := range a.autoLoginTokens {
		if alt.Owner != username {
			newTokenArray = append(newTokenArray, alt)
		} else {
			//Delete this from the database
			a.Database.Delete("auth", "altoken/"+alt.Token)
		}
	}
	a.autoLoginTokens = newTokenArray
}

func (a *AuthAgent) LoadAutologinTokenFromDB() error {
	entries, err := a.Database.ListTable("auth")
	if err != nil {
		return err
	}
	for _, keypairs := range entries {
		if strings.Contains(string(keypairs[0]), "altoken/") {
			key := string(keypairs[0])
			owner := ""
			json.Unmarshal(keypairs[1], &owner)
			token := strings.Split(key, "/")[1]
			a.autoLoginTokens = append(a.autoLoginTokens, &AutoLoginToken{
				Owner: owner,
				Token: token,
			})
		}
	}

	return nil
}

func (a *AuthAgent) GetUsernameFromToken(token string) (string, error) {
	for _, alt := range a.autoLoginTokens {
		if alt.Token == token {
			return alt.Owner, nil
		}
	}

	return "", errors.New("Invalid Token")
}

func (a *AuthAgent) GetTokensFromUsername(username string) []*AutoLoginToken {
	results := []*AutoLoginToken{}
	for _, alt := range a.autoLoginTokens {
		if alt.Owner == username {
			results = append(results, alt)
		}
	}
	return results
}

func (a *AuthAgent) HandleAutologinTokenLogin(w http.ResponseWriter, r *http.Request) {
	//Get the authentication token from the request
	if a.AllowAutoLogin == false {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte("403 - Forbidden"))
		log.Println("Someone is requesting autologin while this function is turned off.")
		return
	}

	session, _ := a.SessionStore.Get(r, a.SessionName)
	token, err := mv(r, "token", false)
	if err != nil {
		//Username not defined
		sendErrorResponse(w, "Token not defined or empty.")
		return
	}

	//Try to get the username from token
	username, err := a.GetUsernameFromToken(token)
	if err != nil {
		//This token is not valid
		w.WriteHeader(http.StatusUnauthorized)
		//Try to get the autologin error page.
		errtemplate, err := ioutil.ReadFile("./system/errors/invalidToken.html")
		if err != nil {
			w.Write([]byte("401 - Unauthorized (Token not valid)"))
		} else {
			w.Write(errtemplate)
		}
		return
	}

	//Check if the current client has already logged in another account
	currentlyLoggedUsername, err := a.GetUserName(w, r)
	if err == nil && currentlyLoggedUsername != username {
		//The current client already logged in with another user account!
		w.WriteHeader(http.StatusAccepted)
		errtemplate, err := ioutil.ReadFile("./system/errors/alreadyLoggedin.html")
		if err != nil {
			w.Write([]byte("202 - Accepted (Already logged in as another user)"))
		} else {
			w.Write(errtemplate)
		}
		return
	}

	//Ok. Allow this client to login
	session.Values["authenticated"] = true
	session.Values["username"] = username
	session.Values["rememberMe"] = false

	log.Println(username + " logged in via auto-login token")

	//Check if remember me is clicked. If yes, set the maxage to 1 week.
	session.Options = &sessions.Options{
		MaxAge: 3600 * 1, //1 hour
		Path:   "/",
	}

	session.Save(r, w)

	redirectTarget, _ := mv(r, "redirect", false)
	if redirectTarget != "" {
		//Redirect to target website
		http.Redirect(w, r, redirectTarget, http.StatusTemporaryRedirect)
	} else {
		//Redirect this client to its interface module
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
	}

}

//Check if the given autologin token is valid. Autologin token is different from session token (aka token)
func (a *AuthAgent) ValidateAutoLoginToken(token string) (bool, string) {
	//Try to get the username from token
	username, err := a.GetUsernameFromToken(token)
	if err != nil {
		//This token is not valid
		return false, ""
	}

	//Token is valid
	return true, username
}
