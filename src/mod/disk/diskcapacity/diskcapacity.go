package diskcapacity

import (
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"runtime"
	"strings"
	"log"
	"strconv"
	"os/exec"

	"imuslab.com/arozos/mod/common"
	"imuslab.com/arozos/mod/disk/diskspace"
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

type Capacity struct {
	PhysicalDevice    string //The ID of the physical device, like C:/ or /dev/sda1
	MountingHierarchy string //The Mounting Hierarchy of the vroot
	Used              int64  //Used capacity in bytes
	Avilable          int64  //Avilable capacity in bytes
	Total             int64  //Total capacity in bytes
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

func (cr *Resolver) ResolveCapacityInfo(username string, vpath string) (*Capacity, error) {
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
	return cr.GetCapacityInfo(realpath)
}

func (cr *Resolver) GetCapacityInfo(realpath string) (*Capacity, error) {
	rpathAbs, err := filepath.Abs(realpath)
	if err != nil {
		return nil, err
	}

	if runtime.GOOS == "windows" {
		//Windows
		//Extract disk ID from path
		rpathAbs = filepath.ToSlash(filepath.Clean(rpathAbs))
		diskRoot := strings.Split(rpathAbs, "/")[0]

		//Match the disk space info generated from diskspace
		logicDiskInfo := diskspace.GetAllLogicDiskInfo()
		for _, ldi := range logicDiskInfo {
			if strings.TrimSpace(ldi.Device) == strings.TrimSpace(diskRoot) {
				//Matching device ID
				return &Capacity{
					PhysicalDevice: ldi.Device,
					Used:           ldi.Used,
					Avilable:       ldi.Available,
					Total:          ldi.Volume,
				}, nil
			}
		}

	} else {
		//Assume Linux or Mac
		//Use command: df -P {abs_path}
		cmd := exec.Command("df", "-P", rpathAbs)
		log.Println("df", "-P", rpathAbs)
		out, err := cmd.CombinedOutput()
		if err != nil {
			return nil, err
		}

		//Get the last line of the output
		diskInfo := strings.TrimSpace(string(out))
		tmp := strings.Split(diskInfo, "\n")
		targetDiskInfo := strings.Join(tmp[len(tmp) - 1:], " ");
		for strings.Contains(targetDiskInfo, "  "){
			targetDiskInfo = strings.ReplaceAll(targetDiskInfo, "  ", " ")
		}

		diskInfoSlice := strings.Split(targetDiskInfo, " ")

		if len(diskInfoSlice) < 4{
			return nil, errors.New("Malformed output for df -P")
		}

		//Extract capacity information from df output
		total, err := strconv.ParseInt(diskInfoSlice[1], 10, 64)
		if err != nil{
			return nil, errors.New("Malformed output for df -P")
		}

		used, err := strconv.ParseInt(diskInfoSlice[2], 10, 64)
		if err != nil{
			return nil, errors.New("Malformed output for df -P")
		}

		availbe, err := strconv.ParseInt(diskInfoSlice[3], 10, 64)
		if err != nil{
			return nil, errors.New("Malformed output for df -P")
		}

		//Return the capacity info struct, capacity is reported in 1024 bytes block
		return &Capacity{
			PhysicalDevice: diskInfoSlice[0],
			Used: used * 1024,
			Avilable: availbe * 1024,
			Total: total * 1024,
		}, nil
	}

	return nil, errors.New("Unable to resolve matching disk capacity information")
}
