package service

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/filesystem/shortcut"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

/*
	Desktop files and icon positions
*/

// desktopVpath is the folder every user's desktop is listed from
const desktopVpath = "user:/Desktop/"

// desktopObject is one item on the desktop as sent to the client
type desktopObject struct {
	Filepath      string
	Filename      string
	Ext           string
	IsDir         bool
	IsEmptyDir    bool
	IsShortcut    bool
	IsShared      bool
	ShortcutImage string
	ShortcutType  string
	ShortcutName  string
	ShortcutPath  string
	//Optional launch options of url shortcuts
	ShortcutTitle  string
	ShortcutOpenIn string
	ShortcutWidth  int
	ShortcutHeight int
	IconX          int
	IconY          int
}

// initUserFolderStructure creates the user's desktop, seeded from the template folder, on first use
func (s *Service) initUserFolderStructure(userinfo *user.User) {
	userfsh, err := userinfo.GetHomeFileSystemHandler()
	if err != nil {
		logger.PrintAndLog("Desktop", "Unable to initiate user desktop folder", err)
		return
	}

	userFsa := userfsh.FileSystemAbstraction
	userDesktopPath, _ := userFsa.VirtualPathToRealPath("user:/Desktop", userinfo.Username)
	if userFsa.FileExists(userDesktopPath) {
		return
	}

	//Desktop directory not exists. Create one and copy a template desktop
	userFsa.MkdirAll(userDesktopPath, 0755)
	if !utils.FileExists(s.opts.TemplateFolder) {
		return
	}
	templateFiles, _ := filepath.Glob(filepath.Join(s.opts.TemplateFolder, "*"))
	for _, tfile := range templateFiles {
		input, err := os.ReadFile(tfile)
		if err != nil {
			continue
		}
		userFsa.WriteFile(arozfs.ToSlash(filepath.Join(userDesktopPath, filepath.Base(tfile))), input, 0755)
	}
}

// isHiddenFile reports whether a desktop entry should be skipped
func isHiddenFile(name string) bool {
	return strings.HasPrefix(filepath.Base(name), ".")
}

func (s *Service) handleListDesktop(w http.ResponseWriter, r *http.Request) {
	userinfo, err := s.opts.Users.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "user not logged in!")
		return
	}

	//Initiate the user folder structure. Do nothing if the structure already exists.
	s.initUserFolderStructure(userinfo)

	//List all files inside the user desktop directory
	fsh, subpath, err := s.opts.ResolveVirtualPath(desktopVpath)
	if err != nil {
		utils.SendErrorResponse(w, "Desktop file load failed")
		return
	}
	fshAbs := fsh.FileSystemAbstraction
	userDesktopRealpath, err := fshAbs.VirtualPathToRealPath(subpath, userinfo.Username)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	files, err := fshAbs.Glob(userDesktopRealpath + "/*")
	if err != nil {
		utils.SendErrorResponse(w, "Desktop file load failed")
		return
	}

	desktopFiles := []desktopObject{}
	for _, this := range files {
		if isHiddenFile(this) {
			continue
		}
		//Always use linux convension for directory seperator
		this = filepath.ToSlash(this)
		thisFileObject := desktopObject{
			Filename:   filepath.Base(this),
			Ext:        filepath.Ext(this),
			IsDir:      fshAbs.IsDir(this),
			IsEmptyDir: true,
		}
		thisFileObject.Filepath, _ = fshAbs.RealPathToVirtualPath(this, userinfo.Username)

		if thisFileObject.IsDir {
			//A folder is empty when it holds no visible files
			filesInFolder, _ := fshAbs.Glob(filepath.ToSlash(filepath.Clean(this)) + "/*")
			for _, f := range filesInFolder {
				if !isHiddenFile(f) {
					thisFileObject.IsEmptyDir = false
					break
				}
			}
		}

		if thisFileObject.Ext == ".shortcut" {
			thisFileObject.IsShortcut = true
			shortcutInfo, _ := fshAbs.ReadFile(this)
			shortcutData, err := shortcut.ReadShortcut(shortcutInfo)
			if err != nil {
				thisFileObject.ShortcutType = "invalid"
			} else {
				thisFileObject.ShortcutType = shortcutData.Type
				thisFileObject.ShortcutName = shortcutData.Name
				thisFileObject.ShortcutPath = shortcutData.Path
				thisFileObject.ShortcutImage = shortcutData.Icon
				thisFileObject.ShortcutTitle = shortcutData.WindowTitle
				thisFileObject.ShortcutOpenIn = shortcutData.OpenIn
				thisFileObject.ShortcutWidth = shortcutData.WindowWidth
				thisFileObject.ShortcutHeight = shortcutData.WindowHeight
			}
		}

		if s.opts.Shares != nil {
			thisFileObject.IsShared = s.opts.Shares.FileIsShared(userinfo, thisFileObject.Filepath)
		}

		//Icon position on the desktop, -1 if never placed
		thisFileObject.IconX, thisFileObject.IconY, _ = s.layout.GetIconLocation(userinfo.Username, thisFileObject.Filename)

		desktopFiles = append(desktopFiles, thisFileObject)
	}

	jsonString, _ := json.Marshal(desktopFiles)
	utils.SendJSONResponse(w, string(jsonString))
}

// setIconLocation stores the icon position of a file that exists on the user's desktop
func (s *Service) setIconLocation(userinfo *user.User, filename string, x int, y int) error {
	fsh, subpath, err := s.opts.ResolveVirtualPath(desktopVpath)
	if err != nil {
		return err
	}
	fshAbs := fsh.FileSystemAbstraction
	desktoppath, err := fshAbs.VirtualPathToRealPath(subpath, userinfo.Username)
	if err != nil {
		return err
	}
	targetFilepath := filepath.Join(desktoppath, filename)
	if !fshAbs.FileExists(targetFilepath) {
		return errors.New("Given filename not exists.")
	}

	err = s.layout.SetIconLocation(userinfo.Username, filename, x, y)
	if err != nil {
		logger.PrintAndLog("Desktop", "Unable to store new file location on desktop for file: "+targetFilepath, err)
		return err
	}
	return nil
}

// handleIconLocation gets, sets or deletes the desktop position of an icon
func (s *Service) handleIconLocation(w http.ResponseWriter, r *http.Request) {
	userinfo, err := s.opts.Users.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	get, _ := utils.PostPara(r, "get") //Get the position of the given filename
	set, _ := utils.PostPara(r, "set") //Set the position of the given filename
	del, _ := utils.PostPara(r, "del") //Delete the given filename coordinate

	if set != "" {
		sx, _ := utils.PostPara(r, "x")
		sy, _ := utils.PostPara(r, "y")
		x, err := strconv.Atoi(sx)
		if err != nil {
			x = 0
		}
		y, err := strconv.Atoi(sy)
		if err != nil {
			y = 0
		}

		err = s.setIconLocation(userinfo, set, x, y)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		utils.SendOK(w)
	} else if get != "" {
		x, y, _ := s.layout.GetIconLocation(userinfo.Username, get)
		jsonString, _ := json.Marshal([]int{x, y})
		utils.SendJSONResponse(w, string(jsonString))
	} else if del != "" {
		s.layout.RemoveIconLocation(userinfo.Username, del)
	} else {
		//No argument has been set
		utils.SendJSONResponse(w, "Paramter missing.")
	}
}
