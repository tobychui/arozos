package service

import (
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/filesystem/shortcut"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

/*
	Desktop shortcuts

	createShortcut writes a new .shortcut file, renameShortcut changes its
	label and getShortcut / updateShortcut back the shortcut editor. The file
	name of an existing shortcut is never changed (desktop icon positions are
	keyed by file name); only the content is rewritten.
*/

// appSlugRegex matches the slug of a container app (see mod/appproxy)
var appSlugRegex = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

// shortcutEdit is the editable content of a shortcut as posted by the editor
type shortcutEdit struct {
	Name   string
	Path   string
	Icon   string
	Title  string
	OpenIn string
	Width  string
	Height string
}

// uniqueShortcutFilename returns a free "<name>.shortcut" path in dir, adding (n) on collisions
func uniqueShortcutFilename(dir string, name string, exists func(string) bool) string {
	filename := dir + "/" + name + ".shortcut"
	for counter := 1; exists(filename); counter++ {
		filename = dir + "/" + name + "(" + strconv.Itoa(counter) + ").shortcut"
	}
	return filename
}

// ensureModuleDesktopIcon renders the padded desktop icon of a web app if it
// does not ship one, returning its web path (or "" when that failed)
func (s *Service) ensureModuleDesktopIcon(moduleIcon string) string {
	desktopIconPath, generated, err := s.icons.EnsureDesktopIcon(moduleIcon)
	if err != nil {
		logger.PrintAndLog("Desktop", "Unable to generate desktop icon for "+moduleIcon, err)
		return ""
	}
	if generated {
		logger.PrintAndLog("Desktop", "Generated desktop icon for "+desktopIconPath, nil)
	}
	return desktopIconPath
}

func (s *Service) handleShortcutCreate(w http.ResponseWriter, r *http.Request) {
	userinfo, err := s.opts.Users.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	shortcutType, err := utils.PostPara(r, "stype")
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	shortcutText, err := utils.PostPara(r, "stext")
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	shortcutPath, err := utils.PostPara(r, "spath")
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	shortcutIcon, err := utils.PostPara(r, "sicon")
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	if shortcutType == "app" && !appSlugRegex.MatchString(shortcutPath) {
		utils.SendErrorResponse(w, "Invalid container app")
		return
	}
	shortcutCreationDest, err := utils.PostPara(r, "sdest")
	if err != nil {
		//Default create on desktop
		shortcutCreationDest = desktopVpath
	}

	if !userinfo.CanWrite(shortcutCreationDest) {
		utils.SendErrorResponse(w, "Permission denied")
		return
	}

	fsh, subpath, err := s.opts.ResolveVirtualPath(shortcutCreationDest)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	fshAbs := fsh.FileSystemAbstraction
	shortcutRealDest, err := fshAbs.VirtualPathToRealPath(subpath, userinfo.Username)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	if !fshAbs.FileExists(shortcutRealDest) {
		fshAbs.MkdirAll(shortcutRealDest, 0755)
	}

	//Filter illegal characters in the shortcut filename
	shortcutText = arozfs.FilterIllegalCharInFilename(shortcutText, " ")
	shortcutFilename := uniqueShortcutFilename(shortcutRealDest, shortcutText, fshAbs.FileExists)

	//Module icons are edge to edge by design. Render a padded squircle desktop
	//icon for the web app if it does not ship one of its own, so the shortcut
	//does not end up with a fully filled icon on the desktop.
	if shortcutType == "module" {
		s.ensureModuleDesktopIcon(shortcutIcon)
	}

	shortcutContent := shortcut.GenerateShortcutBytes(shortcutPath, shortcutType, shortcutText, shortcutIcon)
	err = fshAbs.WriteFile(shortcutFilename, shortcutContent, 0775)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// resolveShortcutFile checks the vpath points to an existing .shortcut file the user may access
func (s *Service) resolveShortcutFile(userinfo *user.User, vpath string, write bool) (*filesystem.FileSystemHandler, string, error) {
	if !strings.EqualFold(filepath.Ext(vpath), ".shortcut") {
		return nil, "", errors.New("Target is not a shortcut file")
	}
	if write && !userinfo.CanWrite(vpath) {
		return nil, "", errors.New("Permission denied")
	}
	if !write && !userinfo.CanRead(vpath) {
		return nil, "", errors.New("Permission denied")
	}

	fsh, subpath, err := s.opts.ResolveVirtualPath(vpath)
	if err != nil {
		return nil, "", err
	}
	rpath, err := fsh.FileSystemAbstraction.VirtualPathToRealPath(subpath, userinfo.Username)
	if err != nil {
		return nil, "", err
	}
	if !fsh.FileSystemAbstraction.FileExists(rpath) || fsh.FileSystemAbstraction.IsDir(rpath) {
		return nil, "", errors.New("Shortcut file not exists")
	}
	return fsh, rpath, nil
}

// readShortcutFile loads and parses a shortcut the user may access
func (s *Service) readShortcutFile(userinfo *user.User, vpath string, write bool) (*filesystem.FileSystemHandler, string, *arozfs.ShortcutData, error) {
	fsh, rpath, err := s.resolveShortcutFile(userinfo, vpath, write)
	if err != nil {
		return nil, "", nil, err
	}
	content, err := fsh.FileSystemAbstraction.ReadFile(rpath)
	if err != nil {
		return nil, "", nil, errors.New("Shortcut file read failed")
	}
	data, err := shortcut.ReadShortcut(content)
	if err != nil {
		return nil, "", nil, err
	}
	return fsh, rpath, data, nil
}

func (s *Service) handleShortcutRename(w http.ResponseWriter, r *http.Request) {
	userinfo, err := s.opts.Users.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	target, err := utils.GetPara(r, "src")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid shortcut file path given")
		return
	}
	newName, err := utils.GetPara(r, "new")
	if err != nil || strings.TrimSpace(newName) == "" {
		utils.SendErrorResponse(w, "Invalid new name given")
		return
	}
	if !strings.HasPrefix(target, desktopVpath) {
		utils.SendErrorResponse(w, "Shortcut not on desktop")
		return
	}

	fsh, rpath, data, err := s.readShortcutFile(userinfo, target, true)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Only the label changes, the launch options are kept
	data.Name = strings.TrimSpace(newName)
	err = fsh.FileSystemAbstraction.WriteFile(rpath, shortcut.EncodeShortcut(data), 0755)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

func (s *Service) handleShortcutGet(w http.ResponseWriter, r *http.Request) {
	userinfo, err := s.opts.Users.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	target, err := utils.GetPara(r, "src")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid shortcut file path given")
		return
	}

	_, _, data, err := s.readShortcutFile(userinfo, target, false)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	js, _ := json.Marshal(struct {
		*arozfs.ShortcutData
		Filepath string
		Writable bool
	}{data, target, userinfo.CanWrite(target)})
	utils.SendJSONResponse(w, string(js))
}

// applyShortcutEdit validates an edit and applies it to the shortcut data.
// canUseModule reports whether the editing user may launch the given web app.
func (s *Service) applyShortcutEdit(data *arozfs.ShortcutData, edit shortcutEdit, canUseModule func(name string) bool) error {
	name := strings.TrimSpace(edit.Name)
	if name == "" {
		return errors.New("Shortcut name cannot be empty")
	}
	targetPath := strings.TrimSpace(edit.Path)
	if targetPath == "" {
		return errors.New("Shortcut target cannot be empty")
	}
	icon := strings.TrimSpace(edit.Icon)

	//The shortcut type is fixed; everything else comes from the editor
	switch data.Type {
	case "url":
		if !shortcut.IsWebURL(targetPath) {
			return errors.New("Target must be a http:// or https:// URL")
		}
		data.WindowTitle = strings.TrimSpace(edit.Title)
		data.OpenIn = shortcut.NormalizeOpenIn(edit.OpenIn)
		data.WindowWidth = shortcut.NormalizeWindowSize(edit.Width)
		data.WindowHeight = shortcut.NormalizeWindowSize(edit.Height)

	case "module":
		//Launch options of a web app are defined by its init.agi
		if s.opts.Modules == nil {
			return errors.New("WebApp not found")
		}
		targetModule := s.opts.Modules.GetModuleInfoByID(targetPath)
		if targetModule == nil || !canUseModule(targetModule.Name) {
			return errors.New("WebApp not found")
		}
		shortcut.ClearLaunchOptions(data)
		//The icon of a WebApp shortcut is the app's own: it is never edited,
		//only replaced when the shortcut is pointed at another app
		if targetModule.Name != data.Path || data.Icon == "" {
			icon = targetModule.IconPath
			if desktopIcon := s.ensureModuleDesktopIcon(icon); desktopIcon != "" {
				icon = desktopIcon
			}
		} else {
			icon = data.Icon
		}

	case "folder":
		shortcut.ClearLaunchOptions(data)

	case "app":
		//A container app: the target is its slug and an administrator decides
		//how it opens, so only the name and icon are the user's
		if !appSlugRegex.MatchString(targetPath) {
			return errors.New("Invalid container app")
		}
		shortcut.ClearLaunchOptions(data)

	default:
		return errors.New("Unsupported shortcut type")
	}

	if icon == "" {
		return errors.New("Shortcut icon cannot be empty")
	}
	if strings.ContainsAny(icon, "\"'<>`") {
		return errors.New("Invalid icon path")
	}

	data.Name = name
	data.Path = targetPath
	data.Icon = icon
	return nil
}

func (s *Service) handleShortcutUpdate(w http.ResponseWriter, r *http.Request) {
	userinfo, err := s.opts.Users.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	target, err := utils.PostPara(r, "src")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid shortcut file path given")
		return
	}

	fsh, rpath, data, err := s.readShortcutFile(userinfo, target, true)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	edit := shortcutEdit{}
	edit.Name, _ = utils.PostPara(r, "stext")
	edit.Path, _ = utils.PostPara(r, "spath")
	edit.Icon, _ = utils.PostPara(r, "sicon")
	edit.Title, _ = utils.PostPara(r, "stitle")
	edit.OpenIn, _ = utils.PostPara(r, "sopenin")
	edit.Width, _ = utils.PostPara(r, "swidth")
	edit.Height, _ = utils.PostPara(r, "sheight")

	//A cropped / preset icon made in the editor replaces the icon path
	var customIcon []byte
	customIconName := ""
	if iconData, _ := utils.PostPara(r, "sicondata"); iconData != "" {
		if data.Type == "module" {
			utils.SendErrorResponse(w, "The icon of a WebApp shortcut cannot be changed")
			return
		}
		customIcon, err = decodeCustomIcon(iconData)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		customIconName = customIconFilename(customIcon)
		edit.Icon = mediaURL(customIconVpath(target, customIconName))
	}

	err = s.applyShortcutEdit(data, edit, userinfo.GetModuleAccessPermission)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	if customIcon != nil {
		err = writeCustomIcon(fsh, rpath, customIconName, customIcon)
		if err != nil {
			utils.SendErrorResponse(w, "Unable to save icon: "+err.Error())
			return
		}
	}

	err = fsh.FileSystemAbstraction.WriteFile(rpath, shortcut.EncodeShortcut(data), 0775)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}
