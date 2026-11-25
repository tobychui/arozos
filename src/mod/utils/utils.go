package utils

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

/*
	Common

	Some commonly used functions in ArozOS

*/

// Response related
func SendTextResponse(w http.ResponseWriter, msg string) {
	logger.DebugTrace("utils", "SendTextResponse")
	w.Write([]byte(msg))
}

// Send JSON response, with an extra json header
func SendJSONResponse(w http.ResponseWriter, json string) {
	defer logger.Out0(logger.In1("utils", "SendJSONResponse", "json", json))
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(json))
}

func SendErrorResponse(w http.ResponseWriter, errMsg string) {
	defer logger.Out0(logger.In1("utils", "SendErrorResponse", "errMsg", errMsg))
	payload, _ := json.Marshal(map[string]string{"error": errMsg})
	w.Header().Set("Content-Type", "application/json")
	w.Write(payload)
}

func SendOK(w http.ResponseWriter) {
	defer logger.Out0(logger.In0("utils", "SendOK"))
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte("\"OK\""))
}

// Get GET parameter
func GetPara(r *http.Request, key string) (out0 string, out1 error) {
	defer logger.Out2(logger.In2("utils", "GetPara", "r", r, "!key", key), &out0, &out1)
	keys, ok := r.URL.Query()[key]
	if !ok || len(keys[0]) < 1 {
		return "", errors.New("invalid " + key + " given")
	} else {
		return keys[0], nil
	}
}

func GetBool(r *http.Request, key string) (out0 bool, out1 error) {
	defer logger.Out2(logger.In2("utils", "GetBool", "r", r, "!key", key), &out0, &out1)
	x, err := GetPara(r, key)
	if err != nil {
		logger.DebugErr("utils", err)
		return false, err
	}

	x = strings.TrimSpace(x)

	if x == "1" || strings.ToLower(x) == "true" {
		return true, nil
	} else if x == "0" || strings.ToLower(x) == "false" {
		return false, nil
	}

	return false, errors.New("invalid boolean given")
}

// Get GET paramter as int
func GetInt(r *http.Request, key string) (out0 int, out1 error) {
	defer logger.Out2(logger.In2("utils", "GetInt", "r", r, "!key", key), &out0, &out1)
	x, err := GetPara(r, key)
	if err != nil {
		logger.DebugErr("utils", err)
		return 0, err
	}

	x = strings.TrimSpace(x)
	rx, err := strconv.Atoi(x)
	if err != nil {
		logger.DebugErr("utils", err)
		return 0, err
	}

	return rx, nil
}

// Get POST paramter
func PostPara(r *http.Request, key string) (out0 string, out1 error) {
	defer logger.Out2(logger.In2("utils", "PostPara", "r", r, "!key", key), &out0, &out1)
	r.ParseForm()
	x := r.Form.Get(key)
	if x == "" {
		return "", errors.New("invalid " + key + " given")
	} else {
		return x, nil
	}
}

func PostBool(r *http.Request, key string) (out0 bool, out1 error) {
	defer logger.Out2(logger.In2("utils", "PostBool", "r", r, "!key", key), &out0, &out1)
	x, err := PostPara(r, key)
	if err != nil {
		logger.DebugErr("utils", err)
		return false, err
	}

	x = strings.TrimSpace(x)

	if x == "1" || strings.ToLower(x) == "true" {
		return true, nil
	} else if x == "0" || strings.ToLower(x) == "false" {
		return false, nil
	}

	return false, errors.New("invalid boolean given")
}

// Get POST paramter as int
func PostInt(r *http.Request, key string) (out0 int, out1 error) {
	defer logger.Out2(logger.In2("utils", "PostInt", "r", r, "!key", key), &out0, &out1)
	x, err := PostPara(r, key)
	if err != nil {
		logger.DebugErr("utils", err)
		return 0, err
	}

	x = strings.TrimSpace(x)
	rx, err := strconv.Atoi(x)
	if err != nil {
		logger.DebugErr("utils", err)
		return 0, err
	}

	return rx, nil
}

func FileExists(filename string) (out0 bool) {
	defer logger.Out1(logger.In1("utils", "FileExists", "filename", filename), &out0)
	_, err := os.Stat(filename)
	if os.IsNotExist(err) {
		return false
	}
	return true
}

func IsDir(path string) bool {
	logger.DebugTrace("utils", "IsDir")
	if FileExists(path) == false {
		return false
	}
	fi, err := os.Stat(path)
	if err != nil {
		logger.DebugErr("utils", err)
		logger.PrintAndLog("Utils", fmt.Sprint(err), nil)
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

func TimeToString(targetTime time.Time) string {
	logger.DebugTrace("utils", "TimeToString")
	return targetTime.Format("2006-01-02 15:04:05")
}

func LoadImageAsBase64(filepath string) (out0 string, out1 error) {
	defer logger.Out2(logger.In1("utils", "LoadImageAsBase64", "filepath", filepath), &out0, &out1)
	if !FileExists(filepath) {
		return "", errors.New("File not exists")
	}
	f, _ := os.Open(filepath)
	reader := bufio.NewReader(f)
	content, _ := io.ReadAll(reader)
	encoded := base64.StdEncoding.EncodeToString(content)
	return string(encoded), nil
}

// Use for redirections
func ConstructRelativePathFromRequestURL(requestURI string, redirectionLocation string) (out0 string) {
	defer logger.Out1(logger.In2("utils", "ConstructRelativePathFromRequestURL", "requestURI", requestURI, "redirectionLocation", redirectionLocation), &out0)
	if strings.Count(requestURI, "/") == 1 {
		//Already root level
		return redirectionLocation
	}
	for i := 0; i < strings.Count(requestURI, "/")-1; i++ {
		redirectionLocation = "../" + redirectionLocation
	}

	return redirectionLocation
}

// Check if given string in a given slice
func StringInArray(arr []string, str string) (out0 bool) {
	defer logger.Out1(logger.In2("utils", "StringInArray", "arr", arr, "str", str), &out0)
	for _, a := range arr {
		if a == str {
			return true
		}
	}
	return false
}

func StringInArrayIgnoreCase(arr []string, str string) (out0 bool) {
	defer logger.Out1(logger.In2("utils", "StringInArrayIgnoreCase", "arr", arr, "str", str), &out0)
	smallArray := []string{}
	for _, item := range arr {
		smallArray = append(smallArray, strings.ToLower(item))
	}

	return StringInArray(smallArray, strings.ToLower(str))
}

// Load template and replace keys within
func Templateload(templateFile string, data map[string]string) (out0 string, out1 error) {
	defer logger.Out2(logger.In2("utils", "Templateload", "templateFile", templateFile, "data", data), &out0, &out1)
	content, err := os.ReadFile(templateFile)
	if err != nil {
		logger.DebugErr("utils", err)
		return "", err
	}

	for key, value := range data {
		key = "{{" + key + "}}"
		content = []byte(strings.ReplaceAll(string(content), key, value))
	}

	return string(content), nil
}

// Apply template from a pre-loaded string
func TemplateApply(templateString string, data map[string]string) (out0 string) {
	defer logger.Out1(logger.In2("utils", "TemplateApply", "templateString", templateString, "data", data), &out0)
	content := []byte(templateString)
	for key, value := range data {
		key = "{{" + key + "}}"
		content = []byte(strings.ReplaceAll(string(content), key, value))
	}

	return string(content)
}

// ValidateFilename checks that a user supplied file or folder name is safe to
// use as a single path element. Characters that are only special to URLs or
// HTML (%, ?, &, #, spaces and quotes) are valid on the supported file systems
// and are deliberately allowed; the API handles their encoding. Names that
// could escape the containing directory or that no supported file system
// accepts are rejected here.
func ValidateFilename(filename string) (out0 error) {
	defer logger.Out1(logger.In1("utils", "ValidateFilename", "filename", filename), &out0)
	if filename == "" {
		return errors.New("filename cannot be empty")
	}
	if filename == "." || filename == ".." {
		return errors.New("filename cannot be . or ..")
	}
	//Windows strips trailing spaces and dots from path components, which can
	//turn names like ".. " into "..". Reject those traversal-like variants.
	if trimmed := strings.TrimRight(filename, " ."); trimmed == "" || trimmed == "." || trimmed == ".." {
		return errors.New("filename cannot be . or ..")
	}
	if strings.ContainsAny(filename, `/\`) {
		return errors.New("filename cannot contain path separators")
	}
	for _, r := range filename {
		if r == 0 || r < 0x20 || r == 0x7f {
			return errors.New("filename cannot contain control characters")
		}
	}
	return nil
}

// ValidateRelativePath checks a relative path made of one or more filename
// segments, as produced by browsers for directory uploads. It rejects absolute
// paths, dot segments, empty segments and segments that ValidateFilename
// rejects, and returns the path with forward slashes.
func ValidateRelativePath(relativePath string) (out0 string, out1 error) {
	defer logger.Out2(logger.In1("utils", "ValidateRelativePath", "relativePath", relativePath), &out0, &out1)
	//Browsers use forward slashes, but a crafted request may use backslashes.
	relativePath = strings.ReplaceAll(relativePath, "\\", "/")
	if relativePath == "" {
		return "", errors.New("path cannot be empty")
	}
	if strings.HasPrefix(relativePath, "/") || filepath.IsAbs(relativePath) || filepath.VolumeName(relativePath) != "" {
		return "", errors.New("path must be relative")
	}

	segments := strings.Split(relativePath, "/")
	for _, segment := range segments {
		if segment == "" || segment == "." || segment == ".." {
			return "", errors.New("path contains invalid segments")
		}
		if filepath.VolumeName(segment) != "" {
			return "", errors.New("path contains invalid segments")
		}
		if err := ValidateFilename(segment); err != nil {
			logger.DebugErr("utils", err)
			return "", err
		}
	}

	return strings.Join(segments, "/"), nil
}
