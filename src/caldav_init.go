package main

/*
	caldav_init.go - CalDAV server initialisation

	Registers the CalDAV handler at /caldav/ and a /.well-known/caldav
	redirect so iOS can auto-discover the calendar service.

	Also registers /api/caldav/credentials (authenticated) which returns
	the CalDAV URL and auto-generates an auto-login token for the calling
	user, giving them a ready-to-use password for iOS Calendar setup.
*/

import (
	"encoding/json"
	"net/http"

	"imuslab.com/arozos/mod/caldav"
	"imuslab.com/arozos/mod/info/logger"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/utils"
)

// CalDAVHandler is the global CalDAV HTTP handler.
var CalDAVHandler *caldav.Handler

// CalDAVInit initialises the CalDAV server and registers API endpoints.
// It must be called after AuthInit() and UserSystemInit().
func CalDAVInit() {
	CalDAVHandler = caldav.NewHandler(caldav.HandlerOptions{
		AuthAgent:   authAgent,
		UserHandler: userHandler,
		Prefix:      "/caldav",
	})

	// Credentials helper – authenticated, non-admin endpoint so any logged-in
	// user can retrieve their own CalDAV connection details.
	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "Calendar",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})
	router.HandleFunc("/api/caldav/credentials", handleCalDAVCredentials)

	logger.PrintAndLog("CalDAV", "CalDAV service started at /caldav/", nil)
}

// handleCalDAVCredentials returns the CalDAV server URL, username and an
// auto-login token the caller can use as a CalDAV password on iOS.
func handleCalDAVCredentials(w http.ResponseWriter, r *http.Request) {
	username, err := authAgent.GetUserName(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "Unable to get username")
		return
	}

	// Re-use an existing token if available, otherwise mint a new one.
	existing := authAgent.GetTokensFromUsername(username)
	var token string
	if len(existing) > 0 {
		token = existing[0].Token
	} else {
		token = authAgent.NewAutologinToken(username)
	}

	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	serverURL := scheme + "://" + r.Host + "/caldav/"

	type credResponse struct {
		ServerURL string `json:"serverURL"`
		Username  string `json:"username"`
		Token     string `json:"token"`
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(credResponse{
		ServerURL: serverURL,
		Username:  username,
		Token:     token,
	})
}
