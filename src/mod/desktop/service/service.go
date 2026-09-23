package service

import (
	"errors"
	"net/http"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/desktop/icons"
	"imuslab.com/arozos/mod/desktop/layout"
	"imuslab.com/arozos/mod/desktop/prefs"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/modules"
	"imuslab.com/arozos/mod/user"
)

/*
	Desktop service

	The HTTP handlers behind the ArozOS web desktop: desktop file listing, icon
	positions, wallpaper theme and preferences, host / user info and desktop
	shortcuts. The reusable pieces live in the sibling packages (icons, layout,
	prefs, wallpaper); this package ties them to the request handlers and main
	only has to construct it and register its routes (src/desktop.go).
*/

// UserProvider resolves the ArozOS user behind a request or a username
type UserProvider interface {
	GetUserInfoFromRequest(w http.ResponseWriter, r *http.Request) (*user.User, error)
	GetUserInfoFromUsername(username string) (*user.User, error)
}

// ShareChecker reports whether a file has been shared by the user
type ShareChecker interface {
	FileIsShared(userinfo *user.User, vpath string) bool
}

// ModuleLookup finds a loaded web app by its name
type ModuleLookup interface {
	GetModuleInfoByID(moduleid string) *modules.ModuleInfo
}

// VirtualPathResolver maps a virtual path to its file system handler and subpath
type VirtualPathResolver func(vpath string) (*filesystem.FileSystemHandler, string, error)

// Router is the part of the permission router the service registers on
type Router interface {
	HandleFunc(endpoint string, handler func(http.ResponseWriter, *http.Request)) error
}

// HostInfo describes this host to the desktop
type HostInfo struct {
	Hostname        string
	DeviceUUID      string
	BuildVersion    string
	InternalVersion string
	DeviceVendor    string
	DeviceModel     string
}

// Options configures a desktop service. Database, Users and ResolveVirtualPath
// are required; the paths fall back to the standard ArozOS layout.
type Options struct {
	Database           *database.Database
	TableName          string //Database table for desktop state, default "desktop"
	WebRoot            string //Folder the web apps are served from, default "./web"
	WallpaperRoot      string //Folder of the bundled wallpaper themes
	TemplateFolder     string //Shortcuts copied onto a new user's desktop
	Users              UserProvider
	Shares             ShareChecker //Optional, nothing is shown as shared when nil
	Modules            ModuleLookup //Optional, module shortcuts cannot be edited when nil
	ResolveVirtualPath VirtualPathResolver
	HostInfo           func() HostInfo //Optional, read on every host info request
}

// Default values of Options
const (
	DefaultTableName      = "desktop"
	DefaultWebRoot        = "./web"
	DefaultWallpaperRoot  = "./web/img/desktop/bg"
	DefaultTemplateFolder = "./system/desktop/template/"
)

// Service serves the desktop API
type Service struct {
	opts   Options
	icons  *icons.Generator //Renders desktop icons for web apps missing one
	layout *layout.Manager  //Where each icon sits on a user's desktop
	prefs  *prefs.Manager   //Per-user desktop preferences and theme
}

// New creates a desktop service and the database table it keeps its state in
func New(opts Options) (*Service, error) {
	if opts.Database == nil {
		return nil, errors.New("desktop service requires a database")
	}
	if opts.Users == nil {
		return nil, errors.New("desktop service requires a user provider")
	}
	if opts.ResolveVirtualPath == nil {
		return nil, errors.New("desktop service requires a virtual path resolver")
	}
	if opts.TableName == "" {
		opts.TableName = DefaultTableName
	}
	if opts.WebRoot == "" {
		opts.WebRoot = DefaultWebRoot
	}
	if opts.WallpaperRoot == "" {
		opts.WallpaperRoot = DefaultWallpaperRoot
	}
	if opts.TemplateFolder == "" {
		opts.TemplateFolder = DefaultTemplateFolder
	}

	layoutManager, err := layout.NewManager(opts.Database, opts.TableName)
	if err != nil {
		return nil, err
	}
	prefsManager, err := prefs.NewManager(opts.Database, opts.TableName)
	if err != nil {
		return nil, err
	}

	return &Service{
		opts:   opts,
		icons:  icons.NewGenerator(opts.WebRoot),
		layout: layoutManager,
		prefs:  prefsManager,
	}, nil
}

// RegisterRoutes registers every desktop endpoint on the given router
func (s *Service) RegisterRoutes(router Router) {
	router.HandleFunc("/system/desktop/listDesktop", s.handleListDesktop)
	router.HandleFunc("/system/desktop/theme", s.handleTheme)
	router.HandleFunc("/system/desktop/files", s.handleIconLocation)
	router.HandleFunc("/system/desktop/host", s.handleHostInfo)
	router.HandleFunc("/system/desktop/user", s.handleUserInfo)
	router.HandleFunc("/system/desktop/preference", s.handlePreference)
	router.HandleFunc("/system/desktop/createShortcut", s.handleShortcutCreate)

	//Operations on existing desktop shortcuts
	router.HandleFunc("/system/desktop/opr/renameShortcut", s.handleShortcutRename)
	router.HandleFunc("/system/desktop/opr/getShortcut", s.handleShortcutGet)
	router.HandleFunc("/system/desktop/opr/updateShortcut", s.handleShortcutUpdate)
}
