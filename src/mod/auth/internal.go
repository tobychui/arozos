package auth

import (
	"errors"
	"net/http"

	"imuslab.com/arozos/mod/info/logger"
)

// Common functions
func sendTextResponse(w http.ResponseWriter, msg string) {
	logger.DebugTrace("auth", "sendTextResponse")
	w.Write([]byte(msg))
}

// Send JSON response, with an extra json header
func sendJSONResponse(w http.ResponseWriter, json string) {
	defer logger.Out0(logger.In1("auth", "sendJSONResponse", "json", json))
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(json))
}

func sendErrorResponse(w http.ResponseWriter, errMsg string) {
	defer logger.Out0(logger.In1("auth", "sendErrorResponse", "errMsg", errMsg))
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte("{\"error\":\"" + errMsg + "\"}"))
}

func sendOK(w http.ResponseWriter) {
	defer logger.Out0(logger.In0("auth", "sendOK"))
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte("\"OK\""))
}

// TODO: Deprecate this Mv
func Mv(r *http.Request, getParamter string, postMode bool) (out0 string, out1 error) {
	defer logger.Out2(logger.In3("auth", "Mv", "r", r, "getParamter", getParamter, "postMode", postMode), &out0, &out1)
	if postMode == false {
		//Access the paramter via GET
		keys, ok := r.URL.Query()[getParamter]

		if !ok || len(keys[0]) < 1 {
			return "", errors.New("GET paramter " + getParamter + " not found or it is empty")
		}

		// Query()["key"] will return an array of items,
		// we only want the single item.
		key := keys[0]
		return string(key), nil
	} else {
		//Access the parameter via POST
		r.ParseForm()
		x := r.Form.Get(getParamter)
		if len(x) == 0 || x == "" {
			return "", errors.New("POST paramter " + getParamter + " not found or it is empty")
		}
		return string(x), nil
	}

}

func inSlice(list []string, a string) (out0 bool) {
	defer logger.Out1(logger.In2("auth", "inSlice", "list", list, "a", a), &out0)
	for _, b := range list {
		if b == a {
			return true
		}
	}
	return false
}
