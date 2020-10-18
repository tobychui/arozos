package auth

import (
	"github.com/gorilla/sessions"
	"net/http"
)

type AuthAgent struct{
	SessionStore *sessions.CookieStore
}

func NewAuthenticationAgent(key []byte) *AuthAgent{
    store := sessions.NewCookieStore(key)
	return &AuthAgent{
		SessionStore: store,
	}
}

func (a *AuthAgent)handleLogin(w http.ResponseWriter, r *http.Request){
	
}

func (a *AuthAgent)handleLogout(w http.ResponseWriter, r *http.Request){

}

func (a *AuthAgent)checkLogin(w http.ResponseWriter, r *http.Request){

}

func (a *AuthAgent)handleRegister(w http.ResponseWriter, r *http.Request){

}

func (a *AuthAgent)handleUnregister(w http.ResponseWriter, r *http.Request){

}


