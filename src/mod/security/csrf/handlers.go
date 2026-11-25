package csrf

import (
	"encoding/json"
	"net/http"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

func (m *TokenManager) HandleNewToken(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("security/csrf", "TokenManager.HandleNewToken", "m", m, "r", r))
	userinfo, err := m.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		logger.DebugErr("security/csrf", err)
		http.Error(w, "Unauthorized", 401)
		return
	}

	newUUID := m.GenerateNewToken(userinfo.Username)
	js, _ := json.Marshal(newUUID)
	utils.SendJSONResponse(w, string(js))
}

// validate the token validation from request
func (m *TokenManager) HandleTokenValidation(w http.ResponseWriter, r *http.Request) (out0 bool) {
	defer logger.Out1(logger.In2("security/csrf", "TokenManager.HandleTokenValidation", "m", m, "r", r), &out0)
	userinfo, err := m.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		logger.DebugErr("security/csrf", err)
		return false
	}

	token, _ := utils.PostPara(r, "csrft")
	if token == "" {
		return false
	} else {
		return m.CheckTokenValidation(userinfo.Username, token)
	}
}
