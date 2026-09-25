package main

import (
	"encoding/json"
	"errors"
	"flag"
	"net/http"
	"strings"

	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/utils"
)

/*
	Startup Flags Manager

	This script is design to provide interface for editing the boot flags
	during the system is running.

	Changes are applied to the runtime and persisted to the system database,
	so they survive a restart. On boot, StartupFlagsRestore loads the stored
	values into the runtime, except for the ones given explicitly as start
	parameters: those win, and overwrite the stored value.
*/

const bootFlagsTable = "bootflags"
const bootFlagsKey = "config"

// bootFlags is the persisted and editable subset of the startup parameters.
// MaxUploadSize and MaxFileUploadBuff are in MB, FileIOBuffer in bytes.
type bootFlags struct {
	Hostname          string
	MaxUploadSize     int
	MaxFileUploadBuff int
	FileIOBuffer      int
	DisableIPResolver bool
	EnableHomePage    bool
	EnableDirListing  bool
}

// bootFlagNames maps each bootFlags field to the command line flag it mirrors
var bootFlagNames = map[string]string{
	"Hostname":          "hostname",
	"MaxUploadSize":     "max_upload_size",
	"MaxFileUploadBuff": "upload_buf",
	"FileIOBuffer":      "iobuf",
	"DisableIPResolver": "disable_ip_resolver",
	"EnableHomePage":    "homepage",
	"EnableDirListing":  "dir_list",
}

// currentBootFlags reads the boot flags from the runtime globals
func currentBootFlags() bootFlags {
	return bootFlags{
		Hostname:          *host_name,
		MaxUploadSize:     int(max_upload_size >> 20),
		MaxFileUploadBuff: *upload_buf,
		FileIOBuffer:      *file_opr_buff,
		DisableIPResolver: *disable_ip_resolve_services,
		EnableHomePage:    *allow_homepage,
		EnableDirListing:  *enable_dir_listing,
	}
}

// applyBootFlags writes the boot flags into the runtime globals
func applyBootFlags(c bootFlags) {
	*host_name = c.Hostname
	*max_upload = c.MaxUploadSize
	max_upload_size = int64(c.MaxUploadSize) << 20
	*upload_buf = c.MaxFileUploadBuff
	*file_opr_buff = c.FileIOBuffer
	*disable_ip_resolve_services = c.DisableIPResolver
	*allow_homepage = c.EnableHomePage
	*enable_dir_listing = c.EnableDirListing
}

// validateBootFlags normalises and checks a config before it is applied
func validateBootFlags(c *bootFlags) error {
	c.Hostname = strings.TrimSpace(c.Hostname)
	if c.Hostname == "" {
		return errors.New("host name cannot be empty")
	}
	if c.MaxUploadSize <= 0 {
		return errors.New("max upload size must be larger than zero")
	}
	if c.MaxFileUploadBuff <= 0 {
		return errors.New("file upload buffer must be larger than zero")
	}
	if c.FileIOBuffer <= 0 {
		return errors.New("file IO buffer must be larger than zero")
	}
	return nil
}

// explicitStartFlags returns the names of the flags given on the command line
func explicitStartFlags() map[string]bool {
	set := map[string]bool{}
	flag.Visit(func(f *flag.Flag) {
		set[f.Name] = true
	})
	return set
}

/*
mergeBootFlags decides the boot flags to run with. Fields whose flag was given
explicitly keep the runtime value, other fields take the stored value when one
exists (and is valid), and fall back to the runtime default otherwise. stored
is kept as raw fields so a config saved by an older version, missing some
fields, only restores the ones it has.
*/
func mergeBootFlags(runtime bootFlags, stored map[string]json.RawMessage, explicit map[string]bool) bootFlags {
	merged := runtime
	restore := func(field string, target interface{}) {
		raw, ok := stored[field]
		if !ok || explicit[bootFlagNames[field]] {
			return
		}
		json.Unmarshal(raw, target)
	}

	restore("Hostname", &merged.Hostname)
	restore("MaxUploadSize", &merged.MaxUploadSize)
	restore("MaxFileUploadBuff", &merged.MaxFileUploadBuff)
	restore("FileIOBuffer", &merged.FileIOBuffer)
	restore("DisableIPResolver", &merged.DisableIPResolver)
	restore("EnableHomePage", &merged.EnableHomePage)
	restore("EnableDirListing", &merged.EnableDirListing)

	//A damaged stored value must not stop the system from booting
	if strings.TrimSpace(merged.Hostname) == "" {
		merged.Hostname = runtime.Hostname
	}
	if merged.MaxUploadSize <= 0 {
		merged.MaxUploadSize = runtime.MaxUploadSize
	}
	if merged.MaxFileUploadBuff <= 0 {
		merged.MaxFileUploadBuff = runtime.MaxFileUploadBuff
	}
	if merged.FileIOBuffer <= 0 {
		merged.FileIOBuffer = runtime.FileIOBuffer
	}
	return merged
}

/*
StartupFlagsRestore loads the persisted boot flags into the runtime. It must
run right after the system database opens and before any service reads these
flags (e.g. the host name is captured by several modules at init).
*/
func StartupFlagsRestore() {
	sysdb.NewTable(bootFlagsTable)

	stored := map[string]json.RawMessage{}
	if sysdb.KeyExists(bootFlagsTable, bootFlagsKey) {
		if err := sysdb.Read(bootFlagsTable, bootFlagsKey, &stored); err != nil {
			systemWideLogger.PrintAndLog("System", "Unable to read stored startup parameters, using defaults", err)
			stored = map[string]json.RawMessage{}
		}
	}

	merged := mergeBootFlags(currentBootFlags(), stored, explicitStartFlags())
	applyBootFlags(merged)

	//Write back so the start flags given this boot overwrite the stored values
	if err := sysdb.Write(bootFlagsTable, bootFlagsKey, merged); err != nil {
		systemWideLogger.PrintAndLog("System", "Unable to persist startup parameters", err)
	}
}

func StartupFlagsInit() {
	//Create a admin permission router for handling requests
	//Register a boot flag modifier
	registerSetting(settingModule{
		Name:         "Runtime",
		Desc:         "Change startup paramter in runtime",
		IconPath:     "SystemAO/info/img/runtime.png",
		Group:        "Info",
		StartDir:     "SystemAO/boot/bootflags.html",
		RequireAdmin: true,
	})

	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	adminRouter.HandleFunc("/system/bootflags", handleBootFlagsFunction)
}

func handleBootFlagsFunction(w http.ResponseWriter, r *http.Request) {
	opr, _ := utils.PostPara(r, "opr")
	if opr == "" {
		//List the current boot flags, together with the fields that were
		//given as start parameters this boot (they override the stored value)
		explicit := explicitStartFlags()
		fromStartFlag := []string{}
		for field, name := range bootFlagNames {
			if explicit[name] {
				fromStartFlag = append(fromStartFlag, field)
			}
		}

		js, _ := json.Marshal(struct {
			bootFlags
			FromStartFlag []string
		}{currentBootFlags(), fromStartFlag})

		utils.SendJSONResponse(w, string(js))
	} else if opr == "set" {
		//Set and update the boot flags
		newSettings, err := utils.PostPara(r, "value")
		if err != nil {
			utils.SendErrorResponse(w, "Invalid new seting value")
			return
		}

		//Fields missing from the request keep their current value
		newConfig := currentBootFlags()
		err = json.Unmarshal([]byte(newSettings), &newConfig)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}

		if err = validateBootFlags(&newConfig); err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}

		//Update the current global flags and persist them for the next boot
		systemWideLogger.PrintAndLog("System", "Updating boot flag to:"+newSettings, nil)
		applyBootFlags(newConfig)
		if err = sysdb.Write(bootFlagsTable, bootFlagsKey, newConfig); err != nil {
			systemWideLogger.PrintAndLog("System", "Unable to persist startup parameters", err)
			utils.SendErrorResponse(w, "Applied to runtime but failed to save: "+err.Error())
			return
		}

		utils.SendOK(w)
	} else {
		utils.SendErrorResponse(w, "Unknown operation")
	}
}
