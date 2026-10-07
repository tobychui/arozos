package share

/*
	Share management API

	Authenticated endpoints under /system/file_system/share/, registered by
	RegisterAPIEndpoints. Reading the share state of a path (info, checkShared)
	never creates a share; shares are only added through create (or the legacy
	get-or-create endpoint "new").
*/

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/share/shareEntry"
	"imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

// APIPrefix is the path every share management endpoint is mounted under
const APIPrefix = "/system/file_system/share/"

// EndpointRegistrar is anything that can mount an authenticated endpoint,
// usually the permission router (prouter.RouterDef) of the File Manager.
type EndpointRegistrar interface {
	HandleFunc(endpoint string, handler func(http.ResponseWriter, *http.Request)) error
}

// RegisterAPIEndpoints mounts the share management API on the given router.
// The router is expected to handle login and module permission checks.
func (s *Manager) RegisterAPIEndpoints(router EndpointRegistrar) {
	router.HandleFunc(APIPrefix+"info", s.HandleShareInfo)
	router.HandleFunc(APIPrefix+"create", s.HandleCreateShare)
	router.HandleFunc(APIPrefix+"update", s.HandleUpdateShare)
	router.HandleFunc(APIPrefix+"delete", s.HandleDeleteShare)
	router.HandleFunc(APIPrefix+"recipients", s.HandleListRecipients)
	router.HandleFunc(APIPrefix+"checkShared", s.HandleShareCheck)
	router.HandleFunc(APIPrefix+"list", s.HandleListAllShares)

	//Legacy endpoints, kept for older web apps and float window callers
	router.HandleFunc(APIPrefix+"new", s.HandleCreateNewShare)
	router.HandleFunc(APIPrefix+"edit", s.HandleEditShare)
}

// ShareInfo is the client facing view of a share. It never carries the
// password hash or the real path of the shared file.
type ShareInfo struct {
	UUID            string
	FileVirtualPath string
	Owner           string
	Permission      string
	Accessibles     []string
	IsFolder        bool
	AccessLevel     string
	AllowDownload   bool
	ShowFileList    bool
	HasPassword     bool
	ExpireAt        int64
	CreatedAt       int64
	IsExpired       bool
	SharePath       string //Relative share link, e.g. /share/<uuid>
}

func newShareInfo(so *shareEntry.ShareOption, now time.Time) *ShareInfo {
	return &ShareInfo{
		UUID:            so.UUID,
		FileVirtualPath: so.FileVirtualPath,
		Owner:           so.Owner,
		Permission:      so.Permission,
		Accessibles:     append([]string{}, so.Accessibles...),
		IsFolder:        so.IsFolder,
		AccessLevel:     so.AccessLevel,
		AllowDownload:   so.AllowDownload,
		ShowFileList:    so.ShowFileList,
		HasPassword:     so.HasPassword(),
		ExpireAt:        so.ExpireAt,
		CreatedAt:       so.CreatedAt,
		IsExpired:       so.IsExpired(now),
		SharePath:       "/share/" + so.UUID,
	}
}

func sendJSON(w http.ResponseWriter, v interface{}) {
	js, err := json.Marshal(v)
	if err != nil {
		utils.SendErrorResponse(w, "Unable to encode response")
		return
	}
	utils.SendJSONResponse(w, string(js))
}

// requirePost rejects requests that change state through GET, so a share
// cannot be created or edited by an image tag or a link on another site.
func requirePost(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		utils.SendErrorResponse(w, "Method not allowed")
		return false
	}
	return true
}

/*
parseShareSettings reads the share settings from the request. Every field
is optional, a missing field is left unchanged.

	permission     anyone / signedin / samegroup / groups / users
	accessibles    comma separated user or group names (groups / users)
	mode           legacy form of the two above, e.g. "users:alice,bob"
	accessLevel    view / edit (edit is folder only)
	allowDownload  true / false
	showFileList   true / false
	password       new password for the share
	clearPassword  true to remove the password
	expireAt       unix timestamp in seconds, 0 for never
	expireIn       seconds from now, takes priority over expireAt
*/
func parseShareSettings(r *http.Request) (shareEntry.ShareSettings, error) {
	settings := shareEntry.ShareSettings{}
	r.ParseForm()

	permission := strings.TrimSpace(r.Form.Get("permission"))
	if permission == "" {
		if mode := strings.TrimSpace(r.Form.Get("mode")); mode != "" {
			ok, sharetype, names := validateShareModes(mode)
			if !ok {
				return settings, errors.New("Invalid share setting")
			}
			permission = sharetype
			settings.Accessibles = names
		}
	} else {
		settings.Accessibles = splitNameList(r.Form.Get("accessibles"))
	}
	if permission != "" {
		settings.Permission = &permission
	}

	if accessLevel := strings.TrimSpace(r.Form.Get("accessLevel")); accessLevel != "" {
		settings.AccessLevel = &accessLevel
	}

	if v, err := utils.PostBool(r, "allowDownload"); err == nil {
		settings.AllowDownload = &v
	}

	if v, err := utils.PostBool(r, "showFileList"); err == nil {
		settings.ShowFileList = &v
	}

	if clear, _ := utils.PostBool(r, "clearPassword"); clear {
		empty := ""
		settings.Password = &empty
	} else if password := r.Form.Get("password"); password != "" {
		settings.Password = &password
	}

	if expireIn := strings.TrimSpace(r.Form.Get("expireIn")); expireIn != "" {
		seconds, err := strconv.ParseInt(expireIn, 10, 64)
		if err != nil || seconds <= 0 {
			return settings, errors.New("Invalid expiry duration")
		}
		expireAt := time.Now().Unix() + seconds
		settings.ExpireAt = &expireAt
	} else if expireAtStr := strings.TrimSpace(r.Form.Get("expireAt")); expireAtStr != "" {
		expireAt, err := strconv.ParseInt(expireAtStr, 10, 64)
		if err != nil {
			return settings, errors.New("Invalid expiry date")
		}
		settings.ExpireAt = &expireAt
	}

	return settings, nil
}

func splitNameList(list string) []string {
	results := []string{}
	for _, name := range strings.Split(list, ",") {
		if name = strings.TrimSpace(name); name != "" {
			results = append(results, name)
		}
	}
	return results
}

/*
Validate Share Mode string
will return
1. bool => Is valid
2. permission type: {basic / groups / users}
3. mode string
*/
func validateShareModes(mode string) (bool, string, []string) {
	// user:a,b,c,d
	validModes := []string{shareEntry.PermissionAnyone, shareEntry.PermissionSignedIn, shareEntry.PermissionSameGroup}
	if utils.StringInArray(validModes, mode) {
		//Standard modes
		return true, mode, []string{}
	} else if len(mode) > 7 && mode[:7] == "groups:" {
		//Handle custom group case like groups:a,b,c,d
		groups := splitNameList(mode[7:])
		return len(groups) > 0, shareEntry.PermissionGroups, groups
	} else if len(mode) > 6 && mode[:6] == "users:" {
		//Handle custom usersname like users:a,b,c,d
		users := splitNameList(mode[6:])
		return len(users) > 0, shareEntry.PermissionUsers, users
	}

	return false, "", []string{}
}

// pathShareInfo is the response of the info endpoint
type pathShareInfo struct {
	Path      string
	Filename  string
	IsFolder  bool
	Size      int64 //Bytes, -1 if not calculated
	FileCount int   //Files inside a folder, -1 if not calculated
	IsShared  bool
	CanManage bool //The user can edit or remove every share listed below
	Shares    []*ShareInfo
}

/*
HandleShareInfo returns the share metadata of a path without changing anything.

	GET share/info?path=user:/Music/album[&folderStat=true]

folderStat walks a shared folder to report its size and file count, which can
be slow on a large folder, so the dialog asks for it separately.
*/
func (s *Manager) HandleShareInfo(w http.ResponseWriter, r *http.Request) {
	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	vpath, err := utils.GetPara(r, "path")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid path given")
		return
	}

	fsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(vpath)
	if err != nil {
		utils.SendErrorResponse(w, "Invalid path given")
		return
	}
	fshAbs := fsh.FileSystemAbstraction
	rpath, err := fshAbs.VirtualPathToRealPath(vpath, userinfo.Username)
	if err != nil || !fshAbs.FileExists(rpath) {
		utils.SendErrorResponse(w, "File not exists")
		return
	}

	result := pathShareInfo{
		Path:      vpath,
		Filename:  arozfs.Base(rpath),
		IsFolder:  fshAbs.IsDir(rpath),
		Size:      -1,
		FileCount: -1,
		Shares:    []*ShareInfo{},
	}

	if !result.IsFolder {
		result.Size = fshAbs.GetFileSize(rpath)
	} else if folderStat, _ := utils.GetBool(r, "folderStat"); folderStat {
		result.Size, result.FileCount = fsh.GetDirctorySizeFromRealPath(rpath, false)
	}

	now := time.Now()
	result.IsShared = s.FileIsShared(userinfo, vpath)
	for _, so := range s.ListSharesOfPath(userinfo, vpath) {
		result.Shares = append(result.Shares, newShareInfo(so, now))
	}
	//Shares listed are the ones this user can manage. A shared path with
	//none listed belongs to someone else.
	result.CanManage = !result.IsShared || len(result.Shares) > 0

	sendJSON(w, result)
}

// HandleCreateShare always adds a new share to the given path (POST path + settings)
func (s *Manager) HandleCreateShare(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	vpath, err := utils.PostPara(r, "path")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid path given")
		return
	}

	settings, err := parseShareSettings(r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	so, err := s.CreateShare(userinfo, vpath, settings)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	sendJSON(w, newShareInfo(so, time.Now()))
}

// HandleUpdateShare changes the settings of a share (POST uuid + settings)
func (s *Manager) HandleUpdateShare(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	uuid, err := utils.PostPara(r, "uuid")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid share uuid given")
		return
	}

	settings, err := parseShareSettings(r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	so, err := s.UpdateShare(userinfo, uuid, settings)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	sendJSON(w, newShareInfo(so, time.Now()))
}

// Check if a file is shared. Returns the first share of the path for older callers.
func (s *Manager) HandleShareCheck(w http.ResponseWriter, r *http.Request) {
	//Get the vpath from paramters
	vpath, err := utils.PostPara(r, "path")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid path given")
		return
	}

	//Get userinfo
	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	type Result struct {
		IsShared   bool
		ShareCount int
		ShareUUID  *ShareInfo
	}

	result := Result{
		IsShared:  s.FileIsShared(userinfo, vpath),
		ShareUUID: &ShareInfo{},
	}
	shares := s.ListSharesOfPath(userinfo, vpath)
	result.ShareCount = len(shares)
	if result.IsShared {
		now := time.Now()
		for _, so := range shares {
			if !so.IsExpired(now) {
				result.ShareUUID = newShareInfo(so, now)
				break
			}
		}
	}
	sendJSON(w, result)
}

// Legacy: return the first share of the path, creating one if it is not shared yet
func (s *Manager) HandleCreateNewShare(w http.ResponseWriter, r *http.Request) {
	//Get the vpath from paramters
	vpath, err := utils.PostPara(r, "path")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid path given")
		return
	}

	//Get userinfo
	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	//Get the target fsh that this vpath come from
	vpathSourceFsh := userinfo.GetRootFSHFromVpathInUserScope(vpath)
	if vpathSourceFsh == nil {
		utils.SendErrorResponse(w, "Invalid vpath given")
		return
	}

	share, err := s.CreateNewShare(userinfo, vpathSourceFsh, vpath)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	sendJSON(w, newShareInfo(share, time.Now()))
}

// Handle Share Edit (legacy, prefer share/update).
// For allowing groups / users, use the following syntax
// groups:group1,group2,group3
// users:user1,user2,user3
// For basic modes, use the following keywords
// anyone / signedin / samegroup
// anyone: Anyone who has the link
// signedin: Anyone logged in to this system
// samegroup: The requesting user has the same (or more) user group as the share owner
func (s *Manager) HandleEditShare(w http.ResponseWriter, r *http.Request) {
	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	uuid, err := utils.PostPara(r, "uuid")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid path given")
		return
	}

	shareMode, _ := utils.PostPara(r, "mode")
	if shareMode == "" {
		shareMode = shareEntry.PermissionSignedIn
	}

	//Validate and extract the storage mode
	ok, sharetype, names := validateShareModes(shareMode)
	if !ok {
		utils.SendErrorResponse(w, "Invalid share setting")
		return
	}

	_, err = s.UpdateShare(userinfo, uuid, shareEntry.ShareSettings{
		Permission:  &sharetype,
		Accessibles: names,
	})
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)
}

// Delete a share by uuid, or every share on a path by vpath
func (s *Manager) HandleDeleteShare(w http.ResponseWriter, r *http.Request) {
	//Get userinfo
	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	//Get the vpath from paramters
	uuid, err := utils.PostPara(r, "uuid")
	if err == nil {
		err = s.DeleteShareByUUID(userinfo, uuid)
	} else {
		//Try to get it from vpath (or path, as sent by the Photo app)
		vpath, perr := utils.PostPara(r, "vpath")
		if perr != nil {
			vpath, perr = utils.PostPara(r, "path")
		}
		if perr != nil {
			utils.SendErrorResponse(w, "Invalid uuid or vpath given")
			return
		}
		if !s.FileIsShared(userinfo, vpath) && len(s.ListSharesOfPath(userinfo, vpath)) == 0 {
			utils.SendErrorResponse(w, "Invalid uuid or vpath given")
			return
		}
		err = s.DeleteShareByVpath(userinfo, vpath)
	}

	if err != nil {
		utils.SendErrorResponse(w, err.Error())
	} else {
		utils.SendOK(w)
	}
}

/*
HandleListRecipients lists the users and permission groups a share can be
given to, for the invite pickers of the share dialog.
*/
func (s *Manager) HandleListRecipients(w http.ResponseWriter, r *http.Request) {
	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	type Recipient struct {
		Username string
		Groups   []string
		IsSelf   bool
	}

	type Result struct {
		Users  []Recipient
		Groups []string
	}

	result := Result{Users: []Recipient{}, Groups: []string{}}
	permissionHandler := s.options.UserHandler.GetPermissionHandler()
	for _, username := range s.options.UserHandler.GetAuthAgent().ListUsers() {
		groups := []string{}
		if pgs, err := permissionHandler.GetUsersPermissionGroup(username); err == nil {
			for _, pg := range pgs {
				groups = append(groups, pg.Name)
			}
		}
		result.Users = append(result.Users, Recipient{
			Username: username,
			Groups:   groups,
			IsSelf:   username == userinfo.Username,
		})
	}
	for _, pg := range permissionHandler.PermissionGroups {
		result.Groups = append(result.Groups, pg.Name)
	}

	sort.Slice(result.Users, func(i, j int) bool {
		return strings.ToLower(result.Users[i].Username) < strings.ToLower(result.Users[j].Username)
	})
	sort.Strings(result.Groups)
	sendJSON(w, result)
}

// List all the shares the user can see (used by the Shares Manager)
func (s *Manager) HandleListAllShares(w http.ResponseWriter, r *http.Request) {
	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}
	fshId, _ := utils.GetPara(r, "fsh")
	results := []*shareEntry.ShareOption{}
	if fshId == "" {
		//List all
		allFsh := userinfo.GetAllFileSystemHandler()
		for _, thisFsh := range allFsh {
			allShares := s.ListAllShareByFshId(thisFsh.UUID, userinfo)
			for _, thisShare := range allShares {
				if s.ShareIsValid(thisShare) {
					results = append(results, thisShare)
				}
			}

		}
	} else {
		//List fsh only
		targetFsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(fshId)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		sharesInThisFsh := s.ListAllShareByFshId(targetFsh.UUID, userinfo)
		for _, thisShare := range sharesInThisFsh {
			if s.ShareIsValid(thisShare) {
				results = append(results, thisShare)
			}
		}
	}

	//Reduce the data
	type Share struct {
		UUID                 string
		FileVirtualPath      string
		Owner                string
		Permission           string
		IsFolder             bool
		IsOwnerOfShare       bool
		CanAccess            bool
		CanOpenInFileManager bool
		CanDelete            bool
		HasPassword          bool
		ExpireAt             int64
		IsExpired            bool
	}

	now := time.Now()
	reducedResult := []*Share{}
	for _, result := range results {
		permissionText := result.Permission
		if result.Permission == shareEntry.PermissionGroups || result.Permission == shareEntry.PermissionUsers {
			permissionText = permissionText + " (" + strings.Join(result.Accessibles, ", ") + ")"
		}
		thisShareInfo := Share{
			UUID:                 result.UUID,
			FileVirtualPath:      result.FileVirtualPath,
			Owner:                result.Owner,
			Permission:           permissionText,
			IsFolder:             result.IsFolder,
			IsOwnerOfShare:       userinfo.Username == result.Owner,
			CanAccess:            result.IsAccessibleBy(userinfo.Username, userinfo.GetUserPermissionGroupNames()),
			CanOpenInFileManager: s.UserCanOpenShareInFileManager(result, userinfo),
			CanDelete:            s.CanModifyShare(userinfo, result),
			HasPassword:          result.HasPassword(),
			ExpireAt:             result.ExpireAt,
			IsExpired:            result.IsExpired(now),
		}

		reducedResult = append(reducedResult, &thisShareInfo)
	}

	sendJSON(w, reducedResult)
}

// shareOwnerOf is a small helper for handlers that need the owner of a share
func (s *Manager) shareOwnerOf(so *shareEntry.ShareOption) (*user.User, error) {
	return s.options.UserHandler.GetUserInfoFromUsername(so.Owner)
}
