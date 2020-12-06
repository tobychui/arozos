package auth

import (
	"errors"
	"net/http"
	"time"

	uuid "github.com/satori/go.uuid"
)

/*
	Token Login Handler
	This module support the API request via a user session login token
*/

type token struct {
	Owner        string
	CreationTime int64
}

//Create a new token based on the given HTTP request
func (a *AuthAgent) NewTokenFromRequest(w http.ResponseWriter, r *http.Request) (string, error) {
	if !a.CheckAuth(r) {
		return "", errors.New("User not logged in")
	} else {
		//Generate a token for this request
		username, _ := a.GetUserName(w, r)
		newToken := a.NewToken(username)

		//Append it to the token storage
		return newToken, nil
	}
}

//Generate and return a new token that will be valid for the given time
func (a *AuthAgent) NewToken(owner string) string {
	//Generate a new token
	newToken := uuid.NewV4().String()

	//Add token to tokenStore
	a.tokenStore.Store(newToken, token{
		Owner:        owner,
		CreationTime: time.Now().Unix(),
	})

	//Return the new token
	return newToken
}

//Get the token owner from the given token
func (a *AuthAgent) GetTokenOwner(tokenString string) (string, error) {
	if val, ok := a.tokenStore.Load(tokenString); ok {
		return val.(token).Owner, nil
	} else {
		return "", errors.New("Token not exists")
	}
}

//validate if the given token is valid
func (a *AuthAgent) TokenValid(tokenString string) bool {
	//Check if the token validation is disabled
	if a.ExpireTime == 0 {
		return false
	}

	//Check if key exists
	if val, ok := a.tokenStore.Load(tokenString); ok {
		//Exists. Check if the time fits
		if time.Now().Unix()-val.(token).CreationTime < a.ExpireTime {
			return true
		} else {
			//Expired
			a.tokenStore.Delete(tokenString)
			return false
		}
	}

	//Token not found
	return false
}

//Run a token store scan and remove all expired tokens
func (a *AuthAgent) ClearTokenStore() {
	currentTime := time.Now().Unix()
	a.tokenStore.Range(func(k interface{}, v interface{}) bool {
		if currentTime-v.(token).CreationTime > a.ExpireTime {
			a.tokenStore.Delete(k)
		}
		return true
	})
}
