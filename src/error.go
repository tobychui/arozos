package main

/*
	This page mainly used to handle error interfaces

*/

import (
	"io/ioutil"
	"net/http"
	"strings"
)

func errorHandleNotFound(w http.ResponseWriter, r *http.Request) {
	notFoundPage := "./web/SystemAO/notfound.html"
	if fileExists(notFoundPage) {

		notFoundTemplateBytes, err := ioutil.ReadFile(notFoundPage)
		notFoundTemplate := string(notFoundTemplateBytes)
		if err != nil {
			http.NotFound(w, r)
		} else {
			//Replace the request URL inside the page
			notFoundTemplate = strings.ReplaceAll(notFoundTemplate, "{{request_url}}", r.RequestURI)
			rel := getRootEscapeFromCurrentPath(r.RequestURI)
			notFoundTemplate = strings.ReplaceAll(notFoundTemplate, "{{root_escape}}", rel)
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte(notFoundTemplate))
		}
	} else {
		http.NotFound(w, r)
	}

}

func errorHandlePermissionDenied(w http.ResponseWriter, r *http.Request) {
	unauthorizedPage := "./web/SystemAO/unauthorized.html"
	if fileExists(unauthorizedPage) {
		notFoundTemplateBytes, err := ioutil.ReadFile(unauthorizedPage)
		notFoundTemplate := string(notFoundTemplateBytes)
		if err != nil {
			http.NotFound(w, r)
		} else {
			//Replace the request URL inside the page
			notFoundTemplate = strings.ReplaceAll(notFoundTemplate, "{{request_url}}", r.RequestURI)
			rel := getRootEscapeFromCurrentPath(r.RequestURI)
			notFoundTemplate = strings.ReplaceAll(notFoundTemplate, "{{root_escape}}", rel)
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte(notFoundTemplate))
		}
	} else {
		http.Error(w, "Not authorized", http.StatusUnauthorized)
	}
}

//Get escape root path, example /asd/asd => ../../
func getRootEscapeFromCurrentPath(requestURL string) string {
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
