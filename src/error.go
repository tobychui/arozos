package main

/*
	This page mainly used to handle error interfaces

*/

import (
	"net/http"
	"os"
	"strings"

	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
)

func errorHandleNotFound(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In1("Core", "errorHandleNotFound", "r", r))
	notFoundPage := "./web/SystemAO/notfound.html"
	if fs.FileExists(notFoundPage) {

		notFoundTemplateBytes, err := os.ReadFile(notFoundPage)
		notFoundTemplate := string(notFoundTemplateBytes)
		if err != nil {
			logger.DebugErr("Core", err)
			http.NotFound(w, r)
		} else {
			//Replace the request URL inside the page
			notFoundTemplate = strings.ReplaceAll(notFoundTemplate, "{{request_url}}", r.RequestURI)
			rel := getRootEscapeFromCurrentPath(r.RequestURI)
			notFoundTemplate = strings.ReplaceAll(notFoundTemplate, "{{root_escape}}", rel)
			w.WriteHeader(http.StatusNotFound)
			w.Header().Set("Content-Type", "text/html")
			w.Write([]byte(notFoundTemplate))
		}
	} else {
		http.NotFound(w, r)
	}

}

func errorHandleInternalServerError(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In1("Core", "errorHandleInternalServerError", "r", r))
	internalServerErrPage := "./web/SystemAO/internalServerError.html"
	if fs.FileExists(internalServerErrPage) {

		templateBytes, err := os.ReadFile(internalServerErrPage)
		template := string(templateBytes)
		if err != nil {
			logger.DebugErr("Core", err)
			http.NotFound(w, r)
		} else {
			//Replace the request URL inside the page
			template = strings.ReplaceAll(template, "{{request_url}}", r.RequestURI)
			rel := getRootEscapeFromCurrentPath(r.RequestURI)
			template = strings.ReplaceAll(template, "{{root_escape}}", rel)
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(template))
		}
	} else {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Internal Server Error"))
	}

}

func errorHandlePermissionDenied(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In1("Core", "errorHandlePermissionDenied", "r", r))
	unauthorizedPage := "./web/SystemAO/unauthorized.html"
	if fs.FileExists(unauthorizedPage) {
		notFoundTemplateBytes, err := os.ReadFile(unauthorizedPage)
		notFoundTemplate := string(notFoundTemplateBytes)
		if err != nil {
			logger.DebugErr("Core", err)
			http.NotFound(w, r)
		} else {
			//Replace the request URL inside the page
			notFoundTemplate = strings.ReplaceAll(notFoundTemplate, "{{request_url}}", r.RequestURI)
			rel := getRootEscapeFromCurrentPath(r.RequestURI)
			notFoundTemplate = strings.ReplaceAll(notFoundTemplate, "{{root_escape}}", rel)
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(notFoundTemplate))
		}
	} else {
		http.Error(w, "Not authorized", http.StatusUnauthorized)
	}
}

// Get escape root path, example /asd/asd => ../../
func getRootEscapeFromCurrentPath(requestURL string) (out0 string) {
	defer logger.Out1(logger.In1("Core", "getRootEscapeFromCurrentPath", "requestURL", requestURL), &out0)
	rel := ""
	if !strings.Contains(requestURL, "/") {
		return ""
	}
	splitter := requestURL
	if splitter[len(splitter)-1:] != "/" {
		splitter = splitter + "/"
	}
	for i := 0; i < len(strings.Split(splitter, "/"))-2; i++ {
		rel += "../"
	}

	return rel
}
