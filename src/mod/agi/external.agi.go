package agi

import (
	"encoding/json"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/utils"
)

type endpointFormat struct {
	Username string `json:"username"`
	Path     string `json:"path"`
}

// Handle request from EXTERNAL RESTFUL API
func (g *Gateway) ExtAPIHandler(w http.ResponseWriter, r *http.Request) {
	// get db
	sysdb := g.Option.UserHandler.GetDatabase()

	if !sysdb.TableExists("external_agi") {
		utils.SendErrorResponse(w, "Invalid Request")
		return
	}

	// get the request URI from the r.URL
	requestURI := filepath.ToSlash(filepath.Clean(r.URL.Path))
	subpathElements := strings.Split(requestURI[1:], "/")

	// check if it contains only two part, [rexec uuid]
	if len(subpathElements) != 3 {
		utils.SendErrorResponse(w, "Invalid Request")
		return
	}

	// check if UUID exists in the database
	// get the info from the database
	data, isExist := g.checkIfExternalEndpointExist(subpathElements[2])
	if !isExist {
		utils.SendErrorResponse(w, "Malform Request, invaild UUID given")
		return
	}

	usernameFromDb := data.Username
	pathFromDb := data.Path

	// get the userinfo and the realPath
	userInfo, err := g.Option.UserHandler.GetUserInfoFromUsername(usernameFromDb)
	if err != nil {
		utils.SendErrorResponse(w, "Invalid username")
		return
	}
	fsh, realPath, err := virtualPathToRealPath(pathFromDb, userInfo)
	if err != nil {
		utils.SendErrorResponse(w, "Invalid filepath")
		return
	}

	// execute!
	start := time.Now()
	//g.ExecuteAGIScript(scriptContent, "", "", w, r, userInfo)
	result, err := g.ExecuteAGIScriptAsUser(fsh, realPath, userInfo, w, r)
	duration := time.Since(start)

	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	w.Write([]byte(result))

	log.Println("[Remote AGI] IP:", r.RemoteAddr, " executed the script ", pathFromDb, "(", realPath, ")", " on behalf of", userInfo.Username, "with total duration: ", duration)

}

func (g *Gateway) AddExternalEndPoint(w http.ResponseWriter, r *http.Request) {
	userInfo, err := g.Option.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}
	// get db
	sysdb := g.Option.UserHandler.GetDatabase()
	if !sysdb.TableExists("external_agi") {
		sysdb.NewTable("external_agi")
	}
	var dat endpointFormat

	// uuid: [path, id]
	path, err := utils.GetPara(r, "path")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid path given")
		return
	}

	// put the data in then marshal
	id := uuid.NewV4().String()

	dat.Path = path
	dat.Username = userInfo.Username

	jsonStr, err := json.Marshal(dat)
	if err != nil {
		utils.SendErrorResponse(w, "Invalid JSON string: "+err.Error())
		return
	}
	sysdb.Write("external_agi", id, string(jsonStr))

	// send the uuid to frontend
	utils.SendJSONResponse(w, "\""+id+"\"")
}

func (g *Gateway) RemoveExternalEndPoint(w http.ResponseWriter, r *http.Request) {
	userInfo, err := g.Option.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	// get db
	sysdb := g.Option.UserHandler.GetDatabase()
	if !sysdb.TableExists("external_agi") {
		sysdb.NewTable("external_agi")
	}
	// get path
	uuid, err := utils.GetPara(r, "uuid")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid uuid given")
		return
	}

	// check if endpoint is here
	data, isExist := g.checkIfExternalEndpointExist(uuid)
	if !isExist {
		utils.SendErrorResponse(w, "UUID does not exists in the database!")
		return
	}

	// make sure user cant see other's endpoint
	if data.Username != userInfo.Username {
		utils.SendErrorResponse(w, "Permission denied")
		return
	}

	// delete record
	sysdb.Delete("external_agi", uuid)

	utils.SendOK(w)
}

func (g *Gateway) ListExternalEndpoint(w http.ResponseWriter, r *http.Request) {
	userInfo, err := g.Option.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	// get db
	sysdb := g.Option.UserHandler.GetDatabase()
	if !sysdb.TableExists("external_agi") {
		sysdb.NewTable("external_agi")
	}

	// declare variable for return
	dataFromDB := make(map[string]endpointFormat)

	// O(n) method to do the lookup
	entries, err := sysdb.ListTable("external_agi")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid table")
		return
	}
	for _, keypairs := range entries {
		//Decode the string
		var dataFromResult endpointFormat
		result := ""
		uuid := string(keypairs[0])
		json.Unmarshal(keypairs[1], &result)
		//fmt.Println(result)
		json.Unmarshal([]byte(result), &dataFromResult)
		if dataFromResult.Username == userInfo.Username {
			dataFromDB[uuid] = dataFromResult
		}
	}

	// marhsal and return
	returnJson, err := json.Marshal(dataFromDB)
	if err != nil {
		utils.SendErrorResponse(w, "Invalid JSON: "+err.Error())
		return
	}
	utils.SendJSONResponse(w, string(returnJson))
}

func (g *Gateway) checkIfExternalEndpointExist(uuid string) (endpointFormat, bool) {
	// get db
	sysdb := g.Option.UserHandler.GetDatabase()
	if !sysdb.TableExists("external_agi") {
		sysdb.NewTable("external_agi")
	}
	var dat endpointFormat

	// check if key exist
	if !sysdb.KeyExists("external_agi", uuid) {
		return dat, false
	}

	// if yes then return the value
	jsonData := ""
	sysdb.Read("external_agi", uuid, &jsonData)
	json.Unmarshal([]byte(jsonData), &dat)

	return dat, true
}
