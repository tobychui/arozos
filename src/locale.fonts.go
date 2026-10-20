package main

import (
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/locale"
	"imuslab.com/arozos/mod/locale/fonts"
	"imuslab.com/arozos/mod/network/gzipmiddleware"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/utils"
)

/*
	System locale files and font library

	The locale files live in ./system/locale and are served at their old
	address, /SystemAO/locale/*, by localeServer (mod/locale): each user gets
	them with the fonts they picked in System Settings > System Fonts filled
	in. The fonts themselves are in ./system/locale/fonts (mod/locale/fonts),
	their generated slices in ./system/cache/fonts.

	User endpoints (login required):
	  GET  /system/fonts/list        families, languages and the caller's choices
	  POST /system/fonts/preference  the caller's font for a language

	Admin endpoints:
	  POST /system/fonts/default     the system default font for a language
	  POST /system/fonts/upload      install font files (multipart "file")
	  POST /system/fonts/delete      remove a family
*/

var (
	localeServer *locale.Server
	fontLibrary  *fonts.Library
)

func LocaleInit() {
	lib, err := fonts.NewLibrary(fonts.Options{
		Root:     filepath.Join(localeRoot, "fonts"),
		CacheDir: filepath.Join("system", "cache", "fonts"),
		DB:       sysdb,
	})
	if err != nil {
		logger.PrintAndLog("Locale", "Font library unavailable, locale files are served without library fonts", err)
		lib = nil
	}
	srv, err := locale.NewServer(locale.Options{
		Root:       localeRoot,
		LegacyRoot: filepath.Join("web", "SystemAO", "locale"),
		Fonts:      lib,
	})
	if err != nil {
		logger.PrintAndLog("Locale", "Unable to serve the system locale files", err)
		return
	}
	localeServer = srv
	if lib == nil {
		return
	}
	fontLibrary = lib
	go lib.Warm(srv.LanguageCodes())

	userRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})
	userRouter.HandleFunc("/system/fonts/list", handleFontList)
	userRouter.HandleFunc("/system/fonts/preference", handleFontPreference)

	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})
	adminRouter.HandleFunc("/system/fonts/default", handleFontDefault)
	adminRouter.HandleFunc("/system/fonts/upload", handleFontUpload)
	adminRouter.HandleFunc("/system/fonts/delete", handleFontDelete)
}

// serveLocaleRequest answers /SystemAO/locale/* for a logged in user
func serveLocaleRequest(w http.ResponseWriter, r *http.Request) {
	username := ""
	if userinfo, err := userHandler.GetUserInfoFromRequest(w, r); err == nil {
		username = userinfo.Username
	}
	serve := func(w http.ResponseWriter, r *http.Request) {
		localeServer.Serve(w, r, username)
	}
	if *enable_gzip && !strings.Contains(r.URL.Path, "/fonts/slice/") {
		//Font slices are WOFF2, compressed already
		gzipmiddleware.CompressFunc(serve)(w, r)
		return
	}
	serve(w, r)
}

func handleFontList(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	type languageView struct {
		Code         string `json:"code"`
		Name         string `json:"name"`
		Choice       string `json:"choice"`       //the user's own choice, "" follows the default
		Default      string `json:"default"`      //the system default, "" or "@system" for device fonts
		AdminDefault string `json:"adminDefault"` //what an admin stored, "" when the factory default applies
		Factory      string `json:"factory"`      //the default shipped in defaults.json
		Effective    string `json:"effective"`    //the family in use, "" for device fonts
	}
	codes := localeServer.LanguageCodes()
	languages := []languageView{}
	for _, l := range localeServer.Languages() {
		languages = append(languages, languageView{
			Code:         l.Code,
			Name:         l.Name,
			Choice:       fontLibrary.Choice(userinfo.Username, l.Code),
			Default:      fontLibrary.Default(l.Code),
			AdminDefault: fontLibrary.AdminDefault(l.Code),
			Factory:      fontLibrary.Factory(l.Code),
			Effective:    fontLibrary.Effective(userinfo.Username, l.Code),
		})
	}

	js, _ := json.Marshal(map[string]interface{}{
		"isAdmin":     userinfo.IsAdmin(),
		"maxFontSize": fonts.MaxFontSize,
		"languages":   languages,
		"families":    fontLibrary.Families(codes),
	})
	utils.SendJSONResponse(w, string(js))
}

func handleFontPreference(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "POST required")
		return
	}
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}
	lang, err := utils.PostPara(r, "lang")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid language")
		return
	}
	family, _ := utils.PostPara(r, "family")
	if err := fontLibrary.SetChoice(userinfo.Username, lang, family); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

func handleFontDefault(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "POST required")
		return
	}
	lang, err := utils.PostPara(r, "lang")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid language")
		return
	}
	family, _ := utils.PostPara(r, "family")
	if err := fontLibrary.SetDefault(lang, family); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

func handleFontUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "POST required")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4*fonts.MaxFontSize)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		utils.SendErrorResponse(w, "The upload is too large or incomplete")
		return
	}
	defer r.MultipartForm.RemoveAll()

	type result struct {
		File  string          `json:"file"`
		Error string          `json:"error,omitempty"`
		Face  *fonts.FaceView `json:"face,omitempty"`
	}
	results := []result{}
	for _, header := range r.MultipartForm.File["file"] {
		res := result{File: header.Filename}
		if header.Size > fonts.MaxFontSize {
			res.Error = "The font is too large"
			results = append(results, res)
			continue
		}
		f, err := header.Open()
		if err != nil {
			res.Error = "Unable to read the upload"
			results = append(results, res)
			continue
		}
		data, err := io.ReadAll(io.LimitReader(f, fonts.MaxFontSize+1))
		f.Close()
		if err != nil || len(data) > fonts.MaxFontSize {
			res.Error = "The font is too large"
			results = append(results, res)
			continue
		}
		face, err := fontLibrary.Install(header.Filename, data)
		if err != nil {
			res.Error = err.Error()
		} else {
			res.Face = &face
		}
		results = append(results, res)
	}
	if len(results) == 0 {
		utils.SendErrorResponse(w, "No font file received")
		return
	}
	js, _ := json.Marshal(results)
	utils.SendJSONResponse(w, string(js))
}

func handleFontDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "POST required")
		return
	}
	family, err := utils.PostPara(r, "family")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid family")
		return
	}
	if err := fontLibrary.Delete(family); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}
