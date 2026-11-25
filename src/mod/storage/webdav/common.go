package webdav

import (
	"bufio"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

/*
	SYSTEM COMMON FUNCTIONS

	This is a system function that put those we usually use function but not belongs to
	any module / system.

	E.g. fileExists / IsDir etc

*/

/*
	Basic Response Functions

	Send response with ease
*/
//Send text response with given w and message as string
func sendTextResponse(w http.ResponseWriter, msg string) {
	defer logger.Out0(logger.In1("storage/webdav", "sendTextResponse", "msg", msg))
	w.Write([]byte(msg))
}

// Send JSON response, with an extra json header
func sendJSONResponse(w http.ResponseWriter, json string) {
	defer logger.Out0(logger.In1("storage/webdav", "sendJSONResponse", "json", json))
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(json))
}

func sendErrorResponse(w http.ResponseWriter, errMsg string) {
	defer logger.Out0(logger.In1("storage/webdav", "sendErrorResponse", "errMsg", errMsg))
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte("{\"error\":\"" + errMsg + "\"}"))
}

func sendOK(w http.ResponseWriter) {
	defer logger.Out0(logger.In0("storage/webdav", "sendOK"))
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte("\"OK\""))
}

/*
The paramter move function (mv)

You can find similar things in the PHP version of ArOZ Online Beta. You need to pass in
r (HTTP Request Object)
getParamter (string, aka $_GET['This string])

Will return
Paramter string (if any)
Error (if error)
*/
func mv(r *http.Request, getParamter string, postMode bool) (out0 string, out1 error) {
	defer logger.Out2(logger.In3("storage/webdav", "mv", "r", r, "getParamter", getParamter, "postMode", postMode), &out0, &out1)
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

func stringInSlice(a string, list []string) (out0 bool) {
	defer logger.Out1(logger.In2("storage/webdav", "stringInSlice", "a", a, "list", list), &out0)
	for _, b := range list {
		if b == a {
			return true
		}
	}
	return false
}

func fileExists(filename string) (out0 bool) {
	defer logger.Out1(logger.In1("storage/webdav", "fileExists", "filename", filename), &out0)
	_, err := os.Stat(filename)
	if os.IsNotExist(err) {
		return false
	}
	return true
}

func isDir(path string) (out0 bool) {
	defer logger.Out1(logger.In1("storage/webdav", "isDir", "path", path), &out0)
	if fileExists(path) == false {
		return false
	}
	fi, err := os.Stat(path)
	if err != nil {
		logger.DebugErr("storage/webdav", err)
		logger.PrintAndLog("Webdav", fmt.Sprint(err), nil)
		os.Exit(1)
		return false
	}
	switch mode := fi.Mode(); {
	case mode.IsDir():
		return true
	case mode.IsRegular():
		return false
	}
	return false
}

func inArray(arr []string, str string) (out0 bool) {
	defer logger.Out1(logger.In2("storage/webdav", "inArray", "arr", arr, "str", str), &out0)
	for _, a := range arr {
		if a == str {
			return true
		}
	}
	return false
}

func timeToString(targetTime time.Time) (out0 string) {
	defer logger.Out1(logger.In1("storage/webdav", "timeToString", "&targetTime", &targetTime), &out0)
	return targetTime.Format("2006-01-02 15:04:05")
}

func loadImageAsBase64(filepath string) (out0 string, out1 error) {
	defer logger.Out2(logger.In1("storage/webdav", "loadImageAsBase64", "filepath", filepath), &out0, &out1)
	if !fileExists(filepath) {
		return "", errors.New("File not exists")
	}
	f, _ := os.Open(filepath)
	reader := bufio.NewReader(f)
	content, _ := io.ReadAll(reader)
	encoded := base64.StdEncoding.EncodeToString(content)
	return string(encoded), nil
}

func pushToSliceIfNotExist(slice []string, newItem string) (out0 []string) {
	defer logger.Out1(logger.In2("storage/webdav", "pushToSliceIfNotExist", "slice", slice, "newItem", newItem), &out0)
	itemExists := false
	for _, item := range slice {
		if item == newItem {
			itemExists = true
		}
	}

	if !itemExists {
		slice = append(slice, newItem)
	}

	return slice
}

func removeFromSliceIfExists(slice []string, target string) (out0 []string) {
	defer logger.Out1(logger.In2("storage/webdav", "removeFromSliceIfExists", "slice", slice, "target", target), &out0)
	newSlice := []string{}
	for _, item := range slice {
		if item != target {
			newSlice = append(newSlice, item)
		}
	}

	return newSlice
}
