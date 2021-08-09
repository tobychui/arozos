package csrf

import (
	"encoding/json"
	"net/http"
)

func (m *TokenManager) HandleNewToken(w http.ResponseWriter, r *http.Request) {
	userinfo, err := m.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		http.Error(w, "Unauthorized", 401)
		return
	}

	newUUID := m.GenerateNewToken(userinfo.Username)
	js, _ := json.Marshal(newUUID)
	sendJSONResponse(w, string(js))
}

//validate the token validation from request
func (m *TokenManager) HandleTokenValidation(w http.ResponseWriter, r *http.Request) bool {
	userinfo, err := m.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		return false
	}

	token, _ := mv(r, "csrft", true)
	if token == "" {
		return false
	} else {
		return m.CheckTokenValidation(userinfo.Username, token)
	}
}
