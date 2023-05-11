package autologin

import (
	"encoding/json"
	"net/http"

	user "imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

type AutoLoginHandler struct {
	userHandler *user.UserHandler
}

func NewAutoLoginHandler(uh *user.UserHandler) *AutoLoginHandler {
	return &AutoLoginHandler{
		userHandler: uh,
	}
}

//List the token given the username
func (a *AutoLoginHandler) HandleUserTokensListing(w http.ResponseWriter, r *http.Request) {
	username, err := utils.GetPara(r, "username")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid username")
		return
	}

	if !a.userHandler.GetAuthAgent().UserExists(username) {
		utils.SendErrorResponse(w, "User not exists!")
		return
	}

	tokens := a.userHandler.GetAuthAgent().GetTokensFromUsername(username)
	tokensOnly := []string{}
	for _, token := range tokens {
		tokensOnly = append(tokensOnly, token.Token)
	}
	jsonString, _ := json.Marshal(tokensOnly)
	utils.SendJSONResponse(w, string(jsonString))
}

//Handle User Token Creation, require username. Please use adminrouter to handle this function
func (a *AutoLoginHandler) HandleUserTokenCreation(w http.ResponseWriter, r *http.Request) {
	username, err := utils.GetPara(r, "username")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid username")
		return
	}

	//Check if user exists
	authAgent := a.userHandler.GetAuthAgent()
	if !authAgent.UserExists(username) {
		utils.SendErrorResponse(w, "User not exists!")
		return
	}

	//Generate and send the token to client
	token := authAgent.NewAutologinToken(username)
	jsonString, _ := json.Marshal(token)
	utils.SendJSONResponse(w, string(jsonString))
}

//Remove the user token given the token
func (a *AutoLoginHandler) HandleUserTokenRemoval(w http.ResponseWriter, r *http.Request) {
	token, err := utils.GetPara(r, "token")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid username")
		return
	}

	authAgent := a.userHandler.GetAuthAgent()
	authAgent.RemoveAutologinToken(token)

	utils.SendOK(w)

}
