package main

/*
	This page mainly used to handle error interfaces

*/

import "net/http"

func errorHandleNotFound(w http.ResponseWriter, r *http.Request) {
	http.NotFound(w, r)
}

func errorHandleNotLoggedIn(w http.ResponseWriter, r *http.Request) {
	http.Error(w, "Not authorized", 401)
}

func errorHandlePermissionDenied(w http.ResponseWriter, r *http.Request) {
	http.Error(w, "Not authorized", 401)
}
