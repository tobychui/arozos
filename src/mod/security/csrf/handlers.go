package csrf

import (
	"encoding/json"
	"net/http"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

func (m *TokenManager) HandleNewToken(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("security/csrf", "TokenManager.HandleNewToken: r=%s", logger.RequestSummary(r))
	}
	userinfo, err := m.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		http.Error(w, "Unauthorized", 401)
		return
	}

	newUUID := m.GenerateNewToken(userinfo.Username)
	js, _ := json.Marshal(newUUID)
	utils.SendJSONResponse(w, string(js))
}

// validate the token validation from request
func (m *TokenManager) HandleTokenValidation(w http.ResponseWriter, r *http.Request) bool {
	if logger.IsDebug() {
		logger.Debugf("security/csrf", "TokenManager.HandleTokenValidation: r=%s", logger.RequestSummary(r))
	}
	userinfo, err := m.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		return false
	}

	token, _ := utils.PostPara(r, "csrft")
	if token == "" {
		return false
	} else {
		return m.CheckTokenValidation(userinfo.Username, token)
	}
}
