package diskcapacity

import (
	"encoding/json"
	"net/http"
	"path/filepath"

	"imuslab.com/arozos/mod/disk/diskcapacity/dftool"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

/*
	Disk Capacity
	This is a simple module to check how many storage space is remaining
	on a given directory in accessiable file system paths

	Author: tobychui
*/

type Resolver struct {
	UserHandler *user.UserHandler
}

type CapacityInfo struct {
	PhysicalDevice    string
	FileSystemType    string
	MountingHierarchy string
	Used              int64
	Available         int64
	Total             int64
}

//Create a new Capacity Resolver with the given user handler
func NewCapacityResolver(u *user.UserHandler) *Resolver {
	return &Resolver{
		UserHandler: u,
	}
}

func (cr *Resolver) HandleCapacityResolving(w http.ResponseWriter, r *http.Request) {
	//Check if the request user is authenticated
	userinfo, err := cr.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	//Get vpath from paramter
	vpath, err := utils.PostPara(r, "path")
	if err != nil {
		utils.SendErrorResponse(w, "Vpath is not defined")
		return
	}

	capinfo, err := cr.ResolveCapacityInfo(userinfo.Username, vpath)
	if err != nil {
		utils.SendErrorResponse(w, "Unable to resolve path capacity information: "+err.Error())
		return
	}

	//Get Storage Hierarcy
	fsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(vpath)
	if err != nil {
		capinfo.MountingHierarchy = "Unknown"
	} else {
		capinfo.MountingHierarchy = fsh.Hierarchy
	}

	//Send the requested path capacity information
	js, _ := json.Marshal(capinfo)
	utils.SendJSONResponse(w, string(js))

}

func (cr *Resolver) ResolveCapacityInfo(username string, vpath string) (*CapacityInfo, error) {
	//Resolve the vpath for this user
	userinfo, err := cr.UserHandler.GetUserInfoFromUsername(username)
	if err != nil {
		return nil, err
	}

	fsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(vpath)
	if err != nil {
		return nil, err
	}

	realpath, err := fsh.FileSystemAbstraction.VirtualPathToRealPath(vpath, username)
	if err != nil {
		return nil, err
	}

	realpath = filepath.ToSlash(filepath.Clean(realpath))

	if utils.FileExists(realpath) && !arozfs.IsNetworkDrive(fsh.Filesystem) {
		//This is a local disk
		capinfo, err := dftool.GetCapacityInfoFromPath(realpath)
		if err != nil {
			return nil, err
		}
		return &CapacityInfo{
			PhysicalDevice:    capinfo.PhysicalDevice,
			FileSystemType:    fsh.Filesystem,
			MountingHierarchy: fsh.Hierarchy,
			Used:              capinfo.Used,
			Available:         capinfo.Available,
			Total:             capinfo.Total,
		}, nil
	} else {
		//This is a remote disk
		return &CapacityInfo{
			PhysicalDevice:    fsh.Path,
			FileSystemType:    fsh.Filesystem,
			MountingHierarchy: fsh.Hierarchy,
			Used:              0,
			Available:         0,
			Total:             0,
		}, nil
	}
}
