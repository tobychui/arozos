package autologin

import (
	"net/http"
	"encoding/json"

	user "imuslab.com/aroz_online/mod/user"
)

type AutoLoginHandler struct{
	userHandler *user.UserHandler
}

func NewAutoLoginHandler(uh *user.UserHandler) *AutoLoginHandler{
	return &AutoLoginHandler{
		userHandler: uh,
	}
}

//List the token given the username
func (a *AutoLoginHandler)HandleUserTokensListing(w http.ResponseWriter, r *http.Request){
	username, err := mv(r, "username", false)
	if err != nil{
		sendErrorResponse(w, "Invalid username");
		return
	}

	if !a.userHandler.GetAuthAgent().UserExists(username){
		sendErrorResponse(w, "User not exists!")
		return
	}

	tokens := a.userHandler.GetAuthAgent().GetTokensFromUsername(username)
	tokensOnly := []string{}
	for _, token := range tokens{
		tokensOnly = append(tokensOnly, token.Token)
	}
	jsonString, _ := json.Marshal(tokensOnly)
	sendJSONResponse(w, string(jsonString))
}

//Handle User Token Creation, require username. Please use adminrouter to handle this function
func (a *AutoLoginHandler)HandleUserTokenCreation(w http.ResponseWriter, r *http.Request){
	username, err := mv(r, "username", false)
	if err != nil{
		sendErrorResponse(w, "Invalid username");
		return
	}

	//Check if user exists
	authAgent := a.userHandler.GetAuthAgent();
	if !authAgent.UserExists(username){
		sendErrorResponse(w, "User not exists!")
		return
	}

	//Generate and send the token to client
	token:= authAgent.NewAutologinToken(username)
	jsonString, _ := json.Marshal(token)
	sendJSONResponse(w, string(jsonString))
}

//Remove the user token given the token
func (a *AutoLoginHandler)HandleUserTokenRemoval(w http.ResponseWriter, r *http.Request){
	token, err := mv(r, "token", false)
	if err != nil{
		sendErrorResponse(w, "Invalid username");
		return
	}

	authAgent := a.userHandler.GetAuthAgent();
	authAgent.RemoveAutologinToken(token)

	sendOK(w)

}	