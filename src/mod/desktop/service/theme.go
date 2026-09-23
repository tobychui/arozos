package service

import (
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"

	"imuslab.com/arozos/mod/desktop/wallpaper"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

/*
	Wallpaper theme and desktop preferences
*/

// handleTheme lists the bundled themes, gets / sets the user's theme, or lists
// the wallpapers inside a user folder
func (s *Service) handleTheme(w http.ResponseWriter, r *http.Request) {
	userinfo, err := s.opts.Users.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	targetTheme, _ := utils.GetPara(r, "set")
	getUserTheme, _ := utils.GetPara(r, "get")
	loadUserTheme, _ := utils.GetPara(r, "load")

	switch {
	case targetTheme == "" && getUserTheme == "" && loadUserTheme == "":
		//List all the bundled themes
		desktopThemeList, err := wallpaper.ListThemes(s.opts.WallpaperRoot)
		if err != nil {
			logger.PrintAndLog("Desktop", "Unable to search bg from destkop image root. Are you sure the web data folder exists?", err)
			return
		}
		jsonString, err := json.Marshal(desktopThemeList)
		if err != nil {
			logger.PrintAndLog("Desktop", "Unable to render desktop wallpaper list", err)
			utils.SendJSONResponse(w, "[]")
			return
		}
		utils.SendJSONResponse(w, string(jsonString))

	case getUserTheme == "true":
		//The user's theme, falling back to the default theme
		jsonString, _ := json.Marshal(s.prefs.GetTheme(userinfo.Username))
		utils.SendJSONResponse(w, string(jsonString))

	case loadUserTheme != "":
		wallpapers, err := s.listFolderWallpapers(userinfo, loadUserTheme)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		js, _ := json.Marshal(wallpapers)
		utils.SendJSONResponse(w, string(js))

	case targetTheme != "":
		s.prefs.SetTheme(userinfo.Username, targetTheme)
		utils.SendOK(w)
	}
}

// listFolderWallpapers returns the virtual paths of the wallpapers inside a user folder
func (s *Service) listFolderWallpapers(userinfo *user.User, folder string) ([]string, error) {
	if !userinfo.CanRead(folder) {
		return nil, errors.New("Permission denied")
	}
	targetFsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(folder)
	if err != nil {
		return nil, errors.New("Unable to resolve user root path")
	}
	fshAbs := targetFsh.FileSystemAbstraction
	rpath, err := fshAbs.VirtualPathToRealPath(folder, userinfo.Username)
	if err != nil || !fshAbs.FileExists(rpath) {
		return nil, errors.New("Custom folder load failed")
	}

	files, err := fshAbs.ReadDir(rpath)
	if err != nil {
		return nil, err
	}
	virtualImageList := []string{}
	for _, file := range files {
		if !wallpaper.IsSupportedWallpaper(file.Name()) {
			continue
		}
		vpath, err := fshAbs.RealPathToVirtualPath(arozfs.ToSlash(filepath.Join(rpath, file.Name())), userinfo.Username)
		if err != nil {
			continue
		}
		virtualImageList = append(virtualImageList, vpath)
	}
	return virtualImageList, nil
}

// handlePreference gets, sets or removes a desktop preference of the user
func (s *Service) handlePreference(w http.ResponseWriter, r *http.Request) {
	userinfo, err := s.opts.Users.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}
	username := userinfo.Username

	preferenceType, _ := utils.PostPara(r, "preference")
	value, _ := utils.PostPara(r, "value")
	remove, _ := utils.PostPara(r, "remove")

	switch {
	case preferenceType != "" && value == "" && remove == "":
		//Getting config from the key
		jsonString, _ := json.Marshal(s.prefs.GetPreference(username, preferenceType))
		utils.SendJSONResponse(w, string(jsonString))
	case preferenceType != "" && value == "" && remove == "true":
		s.prefs.RemovePreference(username, preferenceType)
		utils.SendOK(w)
	case preferenceType != "" && value != "":
		s.prefs.SetPreference(username, preferenceType, value)
		utils.SendOK(w)
	default:
		utils.SendErrorResponse(w, "Error. Undefined paramter.")
	}
}
