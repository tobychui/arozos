package auth

import (
	"errors"
	"net/http"
)

//Common functions
func sendTextResponse(w http.ResponseWriter, msg string) {
	w.Write([]byte(msg))
}

//Send JSON response, with an extra json header
func sendJSONResponse(w http.ResponseWriter, json string) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(json))
}

func sendErrorResponse(w http.ResponseWriter, errMsg string) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte("{\"error\":\"" + errMsg + "\"}"))
}

func sendOK(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte("\"OK\""))
}

//TODO: Deprecate this Mv
func Mv(r *http.Request, getParamter string, postMode bool) (string, error) {
	if postMode == false {
		//Access the paramter via GET
		keys, ok := r.URL.Query()[getParamter]

		if !ok || len(keys[0]) < 1 {
			//log.Println("Url Param " + getParamter +" is missing")
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

func inSlice(list []string, a string) bool {
	for _, b := range list {
		if b == a {
			return true
		}
	}
	return false
}
