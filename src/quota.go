package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/utils"
	//user "imuslab.com/arozos/mod/user"
)

func DiskQuotaInit() {
	//Register Endpoints
	http.HandleFunc("/system/disk/quota/setQuota", system_disk_quota_setQuota)
	http.HandleFunc("/system/disk/quota/quotaInfo", system_disk_quota_handleQuotaInfo)
	http.HandleFunc("/system/disk/quota/quotaDist", system_disk_quota_handleFileDistributionView)

	//Register Setting Interfaces
	registerSetting(settingModule{
		Name:     "Storage Quota",
		Desc:     "User Remaining Space",
		IconPath: "SystemAO/disk/quota/img/small_icon.png",
		Group:    "Disk",
		StartDir: "SystemAO/disk/quota/quota.html",
	})

	//Register the timer for running the global user quota recalculation
	nightlyManager.RegisterNightlyTask(system_disk_quota_updateAllUserQuotaEstimation)
}

//Register the handler for automatically updating all user storage quota
func system_disk_quota_updateAllUserQuotaEstimation() {
	registeredUsers := authAgent.ListUsers()
	for _, username := range registeredUsers {
		//For each user, update their current quota usage
		userinfo, _ := userHandler.GetUserInfoFromUsername(username)
		userinfo.StorageQuota.CalculateQuotaUsage()
	}
}

//Set the storage quota of the particular user
func system_disk_quota_setQuota(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "Unknown User")
		return
	}

	//Check if admin
	if !userinfo.IsAdmin() {
		utils.SendErrorResponse(w, "Permission Denied")
		return
	}

	groupname, err := utils.PostPara(r, "groupname")
	if err != nil {
		utils.SendErrorResponse(w, "Group name not defned")
		return
	}

	quotaSizeString, err := utils.PostPara(r, "quota")
	if err != nil {
		utils.SendErrorResponse(w, "Quota not defined")
		return
	}

	quotaSize, err := utils.StringToInt64(quotaSizeString)
	if err != nil || quotaSize < 0 {
		utils.SendErrorResponse(w, "Invalid quota size given")
		return
	}
	//Qutasize unit is in MB
	quotaSize = quotaSize << 20

	systemWideLogger.PrintAndLog("Quota", "Updating "+groupname+" to "+strconv.FormatInt(quotaSize, 10)+"WIP", nil)
	utils.SendOK(w)

}

func system_disk_quota_handleQuotaInfo(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "Unknown User")
		return
	}

	//Get quota information
	type quotaInformation struct {
		Remaining int64
		Used      int64
		Total     int64
	}

	jsonString, _ := json.Marshal(quotaInformation{
		Remaining: userinfo.StorageQuota.TotalStorageQuota - userinfo.StorageQuota.UsedStorageQuota,
		Used:      userinfo.StorageQuota.UsedStorageQuota,
		Total:     userinfo.StorageQuota.TotalStorageQuota,
	})

	utils.SendJSONResponse(w, string(jsonString))

	go func() {
		//Update this user's quota estimation in go routine
		userinfo.StorageQuota.CalculateQuotaUsage()
	}()
}

var fileExtensions = map[string][]string{
	"CAD":           {"stl", "step", "stp", "obj", "dwg", "dxf", "iges", "igs", "3dm", "sat", "sldprt", "sldasm"},
	"Music":         {"mp3", "flac", "wav", "aac", "ogg", "m4a", "wma", "opus", "alac", "aiff", "mid", "midi"},
	"Video":         {"mp4", "webm", "avi", "mov", "mkv", "flv", "wmv", "m4v", "3gp", "ts", "mts", "vob"},
	"Design":        {"psd", "ai", "xd", "sketch", "fig", "indd", "eps", "cdr", "afdesign", "afphoto"},
	"Documents":     {"pdf", "doc", "docx", "odt", "rtf", "txt", "md", "pages", "tex", "wpd", "fodt", "docm"},
	"Spreadsheets":  {"xls", "xlsx", "ods", "csv", "tsv", "numbers", "xlsm", "xlsb", "fods", "ots"},
	"Presentations": {"ppt", "pptx", "odp", "key", "pptm", "fodp", "otp"},
	"Images":        {"jpg", "jpeg", "png", "gif", "bmp", "tiff", "svg", "webp", "heic", "raw", "cr2", "nef", "arw", "avif", "jxl"},
	"Archives":      {"zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zst", "lz4", "cab", "arj", "lzma"},
	"Code":          {"c", "cpp", "h", "hpp", "java", "py", "js", "ts", "go", "rs", "rb", "php", "swift", "kt", "cs", "vb", "scala", "dart", "zig", "nim", "ex", "exs"},
	"Web":           {"html", "htm", "css", "xml", "json", "yaml", "yml", "toml", "graphql", "wasm", "vue", "jsx", "tsx", "svelte"},
	"Data":          {"sql", "db", "sqlite", "mdb", "accdb", "parquet", "avro", "orc", "hdf5", "feather"},
	"Executables":   {"exe", "msi", "bat", "sh", "app", "apk", "ipa", "deb", "rpm", "run", "com"},
	"System":        {"dll", "sys", "ini", "cfg", "log", "reg", "drv", "tmp", "lock", "pid"},
	"Fonts":         {"ttf", "otf", "woff", "woff2", "eot", "fon", "psf", "pfb", "pfm"},
	"Ebooks":        {"epub", "mobi", "azw", "djvu", "azw3", "fb2", "lit", "cbz", "cbr"},
	"DiskImages":    {"iso", "img", "dmg", "vhd", "vhdx", "vmdk", "qcow2", "vdi", "ova", "ovf"},
	"3DModels":      {"fbx", "blend", "dae", "3ds", "gltf", "glb", "abc", "usd", "usda", "x3d"},
	"Scripts":       {"pl", "lua", "r", "matlab", "ps1", "psm1", "bash", "zsh", "fish", "awk", "sed", "tcl"},
}

//Get all the users files and return size + count per category
func system_disk_quota_handleFileDistributionView(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "Unknown User")
		return
	}

	// Build reverse lookup: extension → category
	extToCategory := make(map[string]string, 300)
	for category, exts := range fileExtensions {
		for _, ext := range exts {
			extToCategory[ext] = category
		}
	}

	type distEntry struct {
		Count int64
		Size  int64
	}
	fileDist := map[string]*distEntry{}

	userFileSystemHandlers := userinfo.GetAllFileSystemHandler()
	for _, thisHandler := range userFileSystemHandlers {
		if thisHandler.Hierarchy == "user" {
			thispath := filepath.ToSlash(filepath.Clean(thisHandler.Path)) + "/users/" + userinfo.Username + "/"
			filepath.Walk(thispath, func(fpath string, info os.FileInfo, err error) error {
				if err != nil {
					return err
				}
				if !info.IsDir() {
					ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(fpath), "."))
					category, ok := extToCategory[ext]
					if !ok {
						mime, _, merr := fs.GetMime(fpath)
						if merr != nil || mime == "" {
							category = "Others"
						} else {
							mediaType := strings.SplitN(mime, "/", 2)[0]
							category = strings.Title(mediaType)
						}
					}
					if fileDist[category] == nil {
						fileDist[category] = &distEntry{}
					}
					fileDist[category].Count++
					fileDist[category].Size += info.Size()
				}
				return nil
			})
		}
	}

	type kv struct {
		Mime  string
		Count int64
		Size  int64
	}

	var ss []kv
	for k, v := range fileDist {
		ss = append(ss, kv{k, v.Count, v.Size})
	}

	sort.Slice(ss, func(i, j int) bool {
		return ss[i].Size > ss[j].Size
	})

	jsonString, _ := json.Marshal(ss)
	utils.SendJSONResponse(w, string(jsonString))
}
