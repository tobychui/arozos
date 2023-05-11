package sortfile

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"

	"imuslab.com/arozos/mod/filesystem"
	user "imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

type LargeFileScanner struct {
	userHandler *user.UserHandler
}

func NewLargeFileScanner(u *user.UserHandler) *LargeFileScanner {
	return &LargeFileScanner{
		userHandler: u,
	}
}

func (s *LargeFileScanner) HandleLargeFileList(w http.ResponseWriter, r *http.Request) {
	userinfo, err := s.userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Check if limit is set. If yes, use the limit in return
	limit, err := utils.GetPara(r, "number")
	if err != nil {
		limit = "20"
	}

	//Try convert the limit to integer
	limitInt, err := strconv.Atoi(limit)
	if err != nil {
		limitInt = 20
	}

	//Get all the fshandler for this user
	fsHandlers := userinfo.GetAllFileSystemHandler()

	type FileObject struct {
		Filename string
		Filepath string
		Size     int64
		IsOwner  bool

		realpath string
		thisfsh  *filesystem.FileSystemHandler
	}
	//Walk all filesystem handlers and buffer all files and their sizes
	fileList := []*FileObject{}
	for _, fsh := range fsHandlers {
		fsh.FileSystemAbstraction.Walk(fsh.Path, func(path string, info os.FileInfo, err error) error {
			if info == nil || err != nil {
				//Disk IO Error
				return errors.New("Disk IO Error: " + err.Error())
			}

			if info.IsDir() {
				return nil
			}

			//Push the current file into the filelist
			if info.Size() > 0 {
				vpath, _ := fsh.FileSystemAbstraction.RealPathToVirtualPath(path, userinfo.Username)
				fileList = append(fileList, &FileObject{
					Filename: filepath.Base(path),
					Filepath: vpath,
					realpath: path,
					thisfsh:  fsh,
					Size:     info.Size(),
					IsOwner:  false,
				})
			}

			return nil
		})

		/*
			if err != nil {
				sendErrorResponse(w, "Failed to scan emulated storage device: "+fsh.Name)
				return
			}
		*/
	}

	//Sort the fileList
	sort.Slice(fileList, func(i, j int) bool {
		return fileList[i].Size > fileList[j].Size
	})

	//Set the max filecount to prevent slice bounds out of range
	if len(fileList) < limitInt {
		limitInt = len(fileList)
	}

	//Only check ownership of those requested
	for _, file := range fileList[:limitInt] {
		if userinfo.IsOwnerOfFile(file.thisfsh, file.Filepath) {
			file.IsOwner = true
		} else {
			file.IsOwner = false
		}
	}

	//Format the results and return
	jsonString, _ := json.Marshal(fileList[:limitInt])
	utils.SendJSONResponse(w, string(jsonString))
}
