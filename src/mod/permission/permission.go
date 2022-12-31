package permission

import (
	"encoding/json"
	"errors"
	"log"
	"strings"

	db "imuslab.com/arozos/mod/database"
	fs "imuslab.com/arozos/mod/filesystem"
	storage "imuslab.com/arozos/mod/storage"
	"imuslab.com/arozos/mod/utils"
)

type PermissionGroup struct {
	Name                   string
	IsAdmin                bool
	DefaultInterfaceModule string
	DefaultStorageQuota    int64
	AccessibleModules      []string
	StoragePool            *storage.StoragePool
	parent                 *PermissionHandler
}

type PermissionHandler struct {
	database         *db.Database
	PermissionGroups []*PermissionGroup
}

func NewPermissionHandler(database *db.Database) (*PermissionHandler, error) {
	//Create the permission table if it is not exists
	err := database.NewTable("permission")
	if err != nil {
		return &PermissionHandler{}, err
	}

	//Check if administrator permission group exists. If not, create one
	if !database.KeyExists("permission", "group/administrator") {
		database.Write("permission", "group/administrator", "[\"*\"]")
		database.Write("permission", "isadmin/administrator", "true")
		database.Write("permission", "quota/administrator", int64(-1))
	}

	return &PermissionHandler{
		database:         database,
		PermissionGroups: []*PermissionGroup{},
	}, nil
}

func (h *PermissionHandler) GroupExists(groupName string) bool {
	exists := false
	for _, gp := range h.PermissionGroups {
		if strings.ToLower(groupName) == strings.ToLower(gp.Name) {
			exists = true
		}
	}
	return exists
}

func (h *PermissionHandler) LoadPermissionGroupsFromDatabase() error {
	entries, err := h.database.ListTable("permission")
	if err != nil {
		return err
	}
	results := []*PermissionGroup{}
	for _, keypairs := range entries {
		if strings.Contains(string(keypairs[0]), "group/") {
			groupname := strings.Split(string(keypairs[0]), "/")[1]
			groupPermission := []string{}
			originalJSONString := ""
			json.Unmarshal(keypairs[1], &originalJSONString)
			err := json.Unmarshal([]byte(originalJSONString), &groupPermission)
			if err != nil {
				log.Println(err)
			}
			//IsAdmin
			isAdmin := "false"
			h.database.Read("permission", "isadmin/"+groupname, &isAdmin)

			//DefaultStorageQuota
			defaultStorageQuota := int64(0)
			h.database.Read("permission", "quota/"+groupname, &defaultStorageQuota)

			//Get the default interface module
			interfaceModule := "Desktop"
			h.database.Read("permission", "interfaceModule/"+groupname, &interfaceModule)

			results = append(results, &PermissionGroup{
				Name:                   groupname,
				IsAdmin:                (isAdmin == "true"),
				DefaultInterfaceModule: interfaceModule,
				AccessibleModules:      groupPermission,
				DefaultStorageQuota:    defaultStorageQuota,
				StoragePool:            &storage.StoragePool{},
				parent:                 h,
			})
		}
	}

	h.PermissionGroups = results
	return nil
}

//Get the user permission groups
func (h *PermissionHandler) GetUsersPermissionGroup(username string) ([]*PermissionGroup, error) {
	//Get user permission group name from database
	targetUserGroup := []string{}
	err := h.database.Read("auth", "group/"+username, &targetUserGroup)
	if err != nil {
		return []*PermissionGroup{}, err
	}

	//Parse the results
	permissionGroupNames := targetUserGroup
	//Look for all the avaible permission groups
	results := []*PermissionGroup{}
	for _, gp := range h.PermissionGroups {
		if utils.StringInArray(permissionGroupNames, gp.Name) {
			//Change the pointer to a new varable to it won't get overwritten by the range function
			newPointer := gp
			results = append(results, newPointer)
		}
	}

	return results, nil
}

func (h *PermissionHandler) UpdatePermissionGroup(name string, isadmin bool, storageQuota int64, moduleNames []string, interfaceModule string) error {
	if !h.GroupExists(name) {
		return errors.New("Permission group not exists or not loaded")
	}

	//Group exists. Update the values
	for _, thisPG := range h.PermissionGroups {
		if thisPG.Name == name {
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
	if isadmin {
		isAdminString = "true"
	}
	moduleJson, _ := json.Marshal(moduleNames)

	//Update the database values
	h.database.Write("permission", "group/"+name, string(moduleJson))
	h.database.Write("permission", "isadmin/"+name, isAdminString)
	h.database.Write("permission", "quota/"+name, storageQuota)
	h.database.Write("permission", "interfaceModule/"+name, interfaceModule)

	return nil
}

func (h *PermissionHandler) NewPermissionGroup(name string, isadmin bool, storageQuota int64, moduleNames []string, interfaceModule string) *PermissionGroup {
	//Create a new storage pool for this permission group
	newPool, err := storage.NewStoragePool([]*fs.FileSystemHandler{}, name)
	if err != nil {
		newPool = &storage.StoragePool{}
	}

	//Create a new permission group
	newGroup := PermissionGroup{
		Name:                   name,
		IsAdmin:                isadmin,
		AccessibleModules:      moduleNames,
		DefaultInterfaceModule: interfaceModule,
		DefaultStorageQuota:    storageQuota,
		StoragePool:            newPool,
		parent:                 h,
	}

	//Write it to database
	isAdminString := "false"
	if isadmin {
		isAdminString = "true"
	}
	moduleJson, _ := json.Marshal(moduleNames)

	h.database.Write("permission", "group/"+name, string(moduleJson))
	h.database.Write("permission", "isadmin/"+name, isAdminString)
	h.database.Write("permission", "quota/"+name, storageQuota)
	h.database.Write("permission", "interfaceModule/"+name, interfaceModule)

	h.PermissionGroups = append(h.PermissionGroups, &newGroup)

	//Return the newly created group
	return &newGroup
}

func (h *PermissionHandler) GetPermissionGroupByNameList(namelist []string) []*PermissionGroup {
	results := []*PermissionGroup{}
	for _, gp := range h.PermissionGroups {
		if utils.StringInArray(namelist, gp.Name) {
			thisPointer := gp
			results = append(results, thisPointer)
		}
	}

	return results
}

func (h *PermissionHandler) GetPermissionGroupByName(name string) *PermissionGroup {
	for _, gp := range h.PermissionGroups {
		if name == gp.Name {
			return gp
		}
	}
	return nil
}
