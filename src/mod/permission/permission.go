package permission

import (
	"strings"
	"encoding/json"
	"net/http"
	"log"
	"errors"

	db "imuslab.com/aroz_online/mod/database"
	storage "imuslab.com/aroz_online/mod/storage"
)


type PermissionGroup struct{
	Name string
	IsAdmin bool
	DefaultInterfaceModule string
	DefaultStorageQuota int64
	AccessibleModules []string
	StoragePool *storage.StoragePool
}

type PermissionHandler struct{
	database *db.Database 
	PermissionGroups []*PermissionGroup
}

func NewPermissionHandler(database *db.Database) (*PermissionHandler, error){
	//Create the permission table if it is not exists
	err := database.NewTable("permission")
	if err != nil{
		return &PermissionHandler{}, err
	}

	//Check if administrator permission group exists. If not, create one
	if !database.KeyExists("permission","group/administrator"){
		database.Write("permission","group/administrator","[\"*\"]")
		database.Write("permission","isadmin/administrator","true")
		database.Write("permission","quota/administrator",int64(-1))
	}

	return &PermissionHandler{
		database: database,
		PermissionGroups: []*PermissionGroup{},
	}, nil
}

func (h *PermissionHandler)GroupExists(groupName string) bool{
	exists := false
	for _, gp := range h.PermissionGroups{
		if strings.ToLower(groupName) == strings.ToLower(gp.Name){
			exists = true
		}
	}
	return exists
}	

func (h *PermissionHandler)LoadPermissionGroupsFromDatabase() error{
	entries, err := h.database.ListTable("permission")
	if err != nil{
		return err
	}
    results := []*PermissionGroup{}
    for _, keypairs := range entries{
        if (strings.Contains(string(keypairs[0]), "group/")){
            groupname:= strings.Split(string(keypairs[0]),"/")[1]
			groupPermission := []string{}
			originalJSONString := ""
			json.Unmarshal(keypairs[1],&originalJSONString);
			err := json.Unmarshal([]byte(originalJSONString),&groupPermission)
			if err != nil{
				log.Println(err)
			}
			//IsAdmin
			isAdmin := "false"
			h.database.Read("permission","isadmin/" + groupname, &isAdmin)

			//DefaultStorageQuota
			defaultStorageQuota := int64(0)
			h.database.Read("permission","quota/" + groupname, &defaultStorageQuota)
			
			//Get the default interface module
			interfaceModule := "Desktop"
			h.database.Read("permission", "interfaceModule/" + groupname, &interfaceModule)

			results = append(results, &PermissionGroup{
				Name: groupname,
				IsAdmin: (isAdmin == "true"),
				DefaultInterfaceModule: interfaceModule,
				AccessibleModules: groupPermission,
				DefaultStorageQuota: defaultStorageQuota,
				StoragePool: &storage.StoragePool{},
			})
        }
	}

	h.PermissionGroups = results
	return nil
}

//Get the user permission groups
func (h *PermissionHandler)GetUsersPermissionGroup(username string) ([]*PermissionGroup, error){
	//Get user permission group name from database
	targetUserGroup := []string{}
	err := h.database.Read("auth","group/" + username, &targetUserGroup);
	if err != nil{
		return []*PermissionGroup{}, err
	}

	//Parse the results
	permissionGroupNames := targetUserGroup
	//Look for all the avaible permission groups
	results := []*PermissionGroup{}
	for _, gp := range h.PermissionGroups{
		if inSlice(permissionGroupNames, gp.Name){
			//Change the pointer to a new varable to it won't get overwritten by the range function
			newPointer := gp
			results = append(results, newPointer)
		}
	}

	return results, nil
}


func (h *PermissionHandler)UpdatePermissionGroup(name string, isadmin bool, storageQuota int64, moduleNames []string, interfaceModule string)  error{
	if !h.GroupExists(name){
		return errors.New("Permission group not exists or not loaded");
	}

	//Group exists. Update the values
	for _, thisPG := range h.PermissionGroups{
		if thisPG.Name == name{
			//Update the permission group values in memeory
			thisPG.IsAdmin = isadmin
			thisPG.DefaultStorageQuota = storageQuota
			thisPG.AccessibleModules = moduleNames
			thisPG.DefaultInterfaceModule = interfaceModule
			break
		}
	}

	//Write it to database
	isAdminString := "false"
	if (isadmin){
		isAdminString = "true"
	}
	moduleJson, _ := json.Marshal(moduleNames);

	//Update the database values
	h.database.Write("permission","group/" + name, string(moduleJson))
	h.database.Write("permission","isadmin/" + name,isAdminString)
	h.database.Write("permission", "quota/" + name, storageQuota)
	h.database.Write("permission", "interfaceModule/" + name, interfaceModule)

	return nil
}

func  (h *PermissionHandler)NewPermissionGroup(name string, isadmin bool, storageQuota int64, moduleNames []string, interfaceModule string) *PermissionGroup{
	//Create a new permission group
	newGroup := PermissionGroup{
		Name: name,
		IsAdmin: isadmin,
		AccessibleModules: moduleNames,
		DefaultInterfaceModule: interfaceModule,
		DefaultStorageQuota: storageQuota,
		StoragePool: &storage.StoragePool{},
	}

	//Write it to database
	isAdminString := "false"
	if (isadmin){
		isAdminString = "true"
	}
	moduleJson, _ := json.Marshal(moduleNames);

	h.database.Write("permission","group/" + name, string(moduleJson))
	h.database.Write("permission","isadmin/" + name,isAdminString)
	h.database.Write("permission", "quota/" + name, storageQuota)
	h.database.Write("permission", "interfaceModule/" + name, interfaceModule)
	
	h.PermissionGroups = append(h.PermissionGroups, &newGroup)

	//Return the newly created group
	return &newGroup
}


func (h *PermissionHandler)GetPermissionGroupByIDs(ids []string) []*PermissionGroup{
	results := []*PermissionGroup{}
	for _, gp := range h.PermissionGroups{
		if inSlice(ids, gp.Name){
			thisPointer := gp
			results = append(results, thisPointer)
		}
	}

	return results;
}

func (h *PermissionHandler)GetPermissionGroupByName(name string) *PermissionGroup{
	for _, gp := range h.PermissionGroups{
		if name == gp.Name{
			return gp
		}
	}
	return nil;
}



//Helper function
func inSlice(slice []string, val string) (bool) {
    for _, item := range slice {
        if item == val {
            return true
        }
    }
    return false
}

//Send text response with given w and message as string
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

func mv(r *http.Request, getParamter string, postMode bool) (string, error) {
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