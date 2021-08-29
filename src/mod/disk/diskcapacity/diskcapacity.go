package diskcapacity

import (
	"encoding/json"
	"net/http"
	"path/filepath"

	"imuslab.com/arozos/mod/common"
	"imuslab.com/arozos/mod/disk/diskcapacity/dftool"
	"imuslab.com/arozos/mod/user"
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
		common.SendErrorResponse(w, "User not logged in")
		return
	}

	//Get vpath from paramter
	vpath, err := common.Mv(r, "path", true)
	if err != nil {
		common.SendErrorResponse(w, "Vpath is not defined")
		return
	}

	capinfo, err := cr.ResolveCapacityInfo(userinfo.Username, vpath)
	if err != nil {
		common.SendErrorResponse(w, "Unable to resolve path capacity information: "+err.Error())
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
	common.SendJSONResponse(w, string(js))

}

func (cr *Resolver) ResolveCapacityInfo(username string, vpath string) (*dftool.Capacity, error) {
	//Resolve the vpath for this user
	userinfo, err := cr.UserHandler.GetUserInfoFromUsername(username)
	if err != nil {
		return nil, err
	}

	realpath, err := userinfo.VirtualPathToRealPath(vpath)
	if err != nil {
		return nil, err
	}

	realpath = filepath.ToSlash(filepath.Clean(realpath))

	return dftool.GetCapacityInfoFromPath(realpath)
}
