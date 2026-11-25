package csrf

/*
	CSRF Token Management Module
	Author: tobychui

	This module handles the genreation and checking of a csrf token
*/

import (
	"sync"
	"time"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/user"
)

type TokenManager struct {
	UserHandler            *user.UserHandler
	csrfTokens             *sync.Map //The token storage
	defaultTokenExpireTime int64     //The timeout for this token in seconds
}

type Token struct {
	ID           string //The ID of the token
	Creator      string //The username of the token creator
	CreationTime int64  //The creation time of this token
	Timeout      int64  //The timeout for this token in seconds
}

// Create a new CSRF Token Manager
func NewTokenManager(uh *user.UserHandler, tokenExpireTime int64) (out0 *TokenManager) {
	defer logger.Out1(logger.In2("security/csrf", "NewTokenManager", "uh", uh, "!tokenExpireTime", tokenExpireTime), &out0)
	tm := TokenManager{
		UserHandler:            uh,
		csrfTokens:             &sync.Map{},
		defaultTokenExpireTime: tokenExpireTime,
	}
	return &tm
}

// Generate a new token
func (m *TokenManager) GenerateNewToken(username string) (out0 string) {
	defer logger.Out1(logger.In2("security/csrf", "TokenManager.GenerateNewToken", "m", m, "username", username), &out0)
	//Generate a new uuid as the token
	newUUID := uuid.NewV4().String()

	//Create a new token
	newToken := Token{
		ID:           newUUID,
		Creator:      username,
		CreationTime: time.Now().Unix(),
		Timeout:      time.Now().Unix() + m.defaultTokenExpireTime,
	}

	//Save the user token
	userMap := m.GetUserTokenMap(username)
	userMap.Store(newUUID, newToken)

	return newUUID
}

func (m *TokenManager) GetUserTokenMap(username string) (out0 *sync.Map) {
	defer logger.Out1(logger.In2("security/csrf", "TokenManager.GetUserTokenMap", "m", m, "username", username), &out0)
	usermap, ok := m.csrfTokens.Load(username)
	if !ok {
		//This user do not have his syncmap. Create one and save it
		userSyncMap := sync.Map{}
		m.csrfTokens.Store(username, &userSyncMap)
		return &userSyncMap
	} else {
		//This user sync map exists. Return the pointer of it
		userSyncMap := usermap.(*sync.Map)
		return userSyncMap
	}
}

// Check if a given token is valud
func (m *TokenManager) CheckTokenValidation(username string, token string) (out0 bool) {
	defer logger.Out1(logger.In3("security/csrf", "TokenManager.CheckTokenValidation", "m", m, "username", username, "!token", token), &out0)
	userSyncMap := m.GetUserTokenMap(username)
	tokenObject, ok := userSyncMap.Load(token)
	if !ok {
		return false
	} else {
		//Token exists. Check if it has expired
		currentTime := time.Now().Unix()
		thisToken := tokenObject.(Token)
		if thisToken.Timeout < currentTime {
			//Expired. Delete token
			userSyncMap.Delete(token)
			return false
		} else {
			userSyncMap.Delete(token)
			return true
		}

	}
}

func (m *TokenManager) ClearExpiredTokens() {
	defer logger.Out0(logger.In1("security/csrf", "TokenManager.ClearExpiredTokens", "m", m))
	currentTime := time.Now().Unix()
	m.csrfTokens.Range(func(username, usermap interface{}) bool {
		//For each user tokens
		thisUserTokenMap := usermap.(*sync.Map)
		thisUserTokenMap.Range(func(tokenid, tokenObject interface{}) bool {
			//For each token in this user
			thisTokenObject := tokenObject.(Token)
			if currentTime > thisTokenObject.Timeout {
				//This token has been expired. Remove it to save some space
				thisUserTokenMap.Delete(tokenid)
			}
			return true
		})
		return true
	})
}
