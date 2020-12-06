package auth

/*
	Auth batch operation handler
	author: tobychui

	This handler handles batch operations related to authentications
	Allowing easy management of the user lists

*/

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
)

/*
	CreateUserAccountsFromCSV

	This function allow mass import of user accounts for organization purpses.
	Must be in the format of:{ username, default password, default group } format.
	Each user occupied one new line
*/
func (a *AuthAgent) HandleCreateUserAccountsFromCSV(w http.ResponseWriter, r *http.Request) {
	csvContent, err := mv(r, "csv", true)
	if err != nil {
		sendErrorResponse(w, "Invalid csv")
		return
	}

	//Process the csv and create user accounts
	newusers := [][]string{}
	csvContent = strings.ReplaceAll(csvContent, "\r\n", "\n")
	lines := strings.Split(csvContent, "\n")
	for _, line := range lines {
		data := strings.Split(line, ",")
		if len(data) >= 3 {
			newusers = append(newusers, data)
		}
	}

	errors := []string{}

	//Ok. Add the valid users to the system
	for _, userCreationSetting := range newusers {
		//Check if this user already exists
		if a.UserExists(userCreationSetting[0]) {
			errors = append(errors, "User "+userCreationSetting[0]+" already exists! Skipping.")
			continue
		}

		a.CreateUserAccount(userCreationSetting[0], userCreationSetting[1], []string{userCreationSetting[2]})
	}

	js, _ := json.Marshal(errors)
	sendJSONResponse(w, string(js))

}

/*
	HandleUserDeleteByGroup handles user batch delete request by group name
	Set exact = true will only delete users which the user is
	1. inside the given group and
	2. that group is his / her only group

	Require paramter: group, exact
*/
func (a *AuthAgent) HandleUserDeleteByGroup(w http.ResponseWriter, r *http.Request) {
	group, err := mv(r, "group", true)
	if err != nil {
		sendErrorResponse(w, "Invalid group")
	}

	requireExact := true //Default true
	exact, _ := mv(r, "exact", true)
	if exact == "false" {
		requireExact = false
	}

	entries, _ := a.Database.ListTable("auth")
	deletePendingUsernames := []string{}

	for _, keypairs := range entries {
		if strings.Contains(string(keypairs[0]), "group/") {
			//Get username
			username := strings.Split(string(keypairs[0]), "/")[1]
			usergroup := []string{}
			a.Database.Read("auth", "group/"+username, &usergroup)

			if requireExact {
				if len(usergroup) == 1 && usergroup[0] == group {
					deletePendingUsernames = append(deletePendingUsernames, username)
				}
			} else {
				if inSlice(usergroup, group) {
					deletePendingUsernames = append(deletePendingUsernames, username)
				}
			}
		}

	}

	for _, username := range deletePendingUsernames {
		a.UnregisterUser(username)
	}

	sendOK(w)

}

/*
	Export all the users into a csv file. Should only be usable via command line as a form of db backup.
	DO NOT EXPOSE THIS TO HTTP SERVER
*/
func (a *AuthAgent) ExportUserListAsCSV() string {
	entries, _ := a.Database.ListTable("auth")
	results := [][]string{}
	for _, keypairs := range entries {
		if strings.Contains(string(keypairs[0]), "passhash/") {

			//This is a user registry
			key := string(keypairs[0])

			//Get username
			username := strings.Split(key, "/")[1]

			//Get usergroup
			usergroup := []string{}
			a.Database.Read("auth", "group/"+username, &usergroup)
			log.Println(usergroup)
			//Get user password hash
			passhash := string(keypairs[1])

			results = append(results, []string{username, passhash, strings.Join(usergroup, ",")})
		}
	}

	//Parse the results as csv
	csv := "Username,Password Hash,Group(s)\n"
	for _, line := range results {
		csv += line[0] + "," + line[1] + "," + line[2] + "\n"
	}

	csv = strings.TrimSpace(csv)

	return csv
}
