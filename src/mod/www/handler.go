package www

import (
	"encoding/json"
	"errors"
	"net/http"

	"imuslab.com/arozos/mod/utils"
)

func (h *Handler) CheckUserHomePageEnabled(username string) bool {
	result := false
	currentHomePageMode := "false"
	err := h.Options.Database.Read("www", username+"_enable", &currentHomePageMode)
	if err != nil {
		//Not exists. Assume false
		result = false
	} else {
		result = (currentHomePageMode == "true")
	}

	return result
}

func (h *Handler) GetUserWebRoot(username string) (string, error) {
	webRoot := ""
	if h.Options.Database.KeyExists("www", username+"_webroot") {
		err := h.Options.Database.Read("www", username+"_webroot", &webRoot)
		if err != nil {
			return "", err
		}

		return webRoot, nil
	} else {
		return "", errors.New("Webroot not defined")
	}

}

func (h *Handler) HandleToggleHomepage(w http.ResponseWriter, r *http.Request) {
	userinfo, err := h.Options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	set, _ := utils.PostPara(r, "set")
	if set == "" {
		//Read mode
		result := h.CheckUserHomePageEnabled(userinfo.Username)
		js, _ := json.Marshal(result)
		utils.SendJSONResponse(w, string(js))

	} else {
		//Set mode
		if set == "true" {
			//Enable homepage
			h.Options.Database.Write("www", userinfo.Username+"_enable", "true")
		} else {
			//Disable homepage
			h.Options.Database.Write("www", userinfo.Username+"_enable", "false")
		}
		utils.SendOK(w)
	}

}

func (h *Handler) HandleSetWebRoot(w http.ResponseWriter, r *http.Request) {
	userinfo, err := h.Options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	set, _ := utils.PostPara(r, "set")
	if set == "" {
		//Read mode
		webroot, err := h.GetUserWebRoot(userinfo.Username)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}

		js, _ := json.Marshal(webroot)
		utils.SendJSONResponse(w, string(js))

	} else {
		//Set mode
		h.Options.Database.Write("www", userinfo.Username+"_webroot", set)

		utils.SendOK(w)
	}
}
