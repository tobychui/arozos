package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"runtime"
	"strconv"
	"time"
)

//SystemSmartExecutable xxx
var SystemSmartExecutable = ""

//SMARTInformation xxx
var SMARTInformation = []SMART{}
var lastScanTime int64 = 0

// DevicesList was used for storing the disk scanning result
type DevicesList struct {
	JSONFormatVersion []int `json:"json_format_version"`
	Smartctl          struct {
		Version      []int    `json:"version"`
		SvnRevision  string   `json:"svn_revision"`
		PlatformInfo string   `json:"platform_info"`
		BuildInfo    string   `json:"build_info"`
		Argv         []string `json:"argv"`
		Messages     []struct {
			String   string `json:"string"`
			Severity string `json:"severity"`
		} `json:"messages"`
		ExitStatus int `json:"exit_status"`
	} `json:"smartctl"`
	Devices []struct {
		Name     string `json:"name"`
		InfoName string `json:"info_name"`
		Type     string `json:"type"`
		Protocol string `json:"protocol"`
	} `json:"devices"`
}

// DeviceSMART was used for storing each disk smart information
type DeviceSMART struct {
	JSONFormatVersion []int `json:"json_format_version"`
	Smartctl          struct {
		Version      []int    `json:"version"`
		SvnRevision  string   `json:"svn_revision"`
		PlatformInfo string   `json:"platform_info"`
		BuildInfo    string   `json:"build_info"`
		Argv         []string `json:"argv"`
		Messages     []struct {
			String   string `json:"string"`
			Severity string `json:"severity"`
		} `json:"messages"`
		ExitStatus int `json:"exit_status"`
	} `json:"smartctl"`
	Device struct {
		Name     string `json:"name"`
		InfoName string `json:"info_name"`
		Type     string `json:"type"`
		Protocol string `json:"protocol"`
	} `json:"device"`
	ModelFamily  string `json:"model_family"`
	ModelName    string `json:"model_name"`
	SerialNumber string `json:"serial_number"`
	Wwn          struct {
		Naa int   `json:"naa"`
		Oui int   `json:"oui"`
		ID  int64 `json:"id"`
	} `json:"wwn"`
	FirmwareVersion string `json:"firmware_version"`
	UserCapacity    struct {
		Blocks int   `json:"blocks"`
		Bytes  int64 `json:"bytes"`
	} `json:"user_capacity"`
	LogicalBlockSize   int  `json:"logical_block_size"`
	PhysicalBlockSize  int  `json:"physical_block_size"`
	RotationRate       int  `json:"rotation_rate"`
	InSmartctlDatabase bool `json:"in_smartctl_database"`
	AtaVersion         struct {
		String     string `json:"string"`
		MajorValue int    `json:"major_value"`
		MinorValue int    `json:"minor_value"`
	} `json:"ata_version"`
	SataVersion struct {
		String string `json:"string"`
		Value  int    `json:"value"`
	} `json:"sata_version"`
	InterfaceSpeed struct {
		Max struct {
			SataValue      int    `json:"sata_value"`
			String         string `json:"string"`
			UnitsPerSecond int    `json:"units_per_second"`
			BitsPerUnit    int    `json:"bits_per_unit"`
		} `json:"max"`
		Current struct {
			SataValue      int    `json:"sata_value"`
			String         string `json:"string"`
			UnitsPerSecond int    `json:"units_per_second"`
			BitsPerUnit    int    `json:"bits_per_unit"`
		} `json:"current"`
	} `json:"interface_speed"`
	LocalTime struct {
		TimeT   int    `json:"time_t"`
		Asctime string `json:"asctime"`
	} `json:"local_time"`
	SmartStatus struct {
		Passed bool `json:"passed"`
	} `json:"smart_status"`
	AtaSmartData struct {
		OfflineDataCollection struct {
			Status struct {
				Value  int    `json:"value"`
				String string `json:"string"`
			} `json:"status"`
			CompletionSeconds int `json:"completion_seconds"`
		} `json:"offline_data_collection"`
		SelfTest struct {
			Status struct {
				Value  int    `json:"value"`
				String string `json:"string"`
				Passed bool   `json:"passed"`
			} `json:"status"`
			PollingMinutes struct {
				Short      int `json:"short"`
				Extended   int `json:"extended"`
				Conveyance int `json:"conveyance"`
			} `json:"polling_minutes"`
		} `json:"self_test"`
		Capabilities struct {
			Values                        []int `json:"values"`
			ExecOfflineImmediateSupported bool  `json:"exec_offline_immediate_supported"`
			OfflineIsAbortedUponNewCmd    bool  `json:"offline_is_aborted_upon_new_cmd"`
			OfflineSurfaceScanSupported   bool  `json:"offline_surface_scan_supported"`
			SelfTestsSupported            bool  `json:"self_tests_supported"`
			ConveyanceSelfTestSupported   bool  `json:"conveyance_self_test_supported"`
			SelectiveSelfTestSupported    bool  `json:"selective_self_test_supported"`
			AttributeAutosaveEnabled      bool  `json:"attribute_autosave_enabled"`
			ErrorLoggingSupported         bool  `json:"error_logging_supported"`
			GpLoggingSupported            bool  `json:"gp_logging_supported"`
		} `json:"capabilities"`
	} `json:"ata_smart_data"`
	AtaSctCapabilities struct {
		Value                         int  `json:"value"`
		ErrorRecoveryControlSupported bool `json:"error_recovery_control_supported"`
		FeatureControlSupported       bool `json:"feature_control_supported"`
		DataTableSupported            bool `json:"data_table_supported"`
	} `json:"ata_sct_capabilities"`
	AtaSmartAttributes struct {
		Revision int `json:"revision"`
		Table    []struct {
			ID         int    `json:"id"`
			Name       string `json:"name"`
			Value      int    `json:"value"`
			Worst      int    `json:"worst"`
			Thresh     int    `json:"thresh"`
			WhenFailed string `json:"when_failed"`
			Flags      struct {
				Value         int    `json:"value"`
				String        string `json:"string"`
				Prefailure    bool   `json:"prefailure"`
				UpdatedOnline bool   `json:"updated_online"`
				Performance   bool   `json:"performance"`
				ErrorRate     bool   `json:"error_rate"`
				EventCount    bool   `json:"event_count"`
				AutoKeep      bool   `json:"auto_keep"`
			} `json:"flags"`
			Raw struct {
				Value  int    `json:"value"`
				String string `json:"string"`
			} `json:"raw"`
		} `json:"table"`
	} `json:"ata_smart_attributes"`
	PowerOnTime struct {
		Hours   int `json:"hours"`
		Minutes int `json:"minutes"`
	} `json:"power_on_time"`
	PowerCycleCount int `json:"power_cycle_count"`
	Temperature     struct {
		Current int `json:"current"`
	} `json:"temperature"`
	AtaSmartSelfTestLog struct {
		Standard struct {
			Revision int `json:"revision"`
			Table    []struct {
				Type struct {
					Value  int    `json:"value"`
					String string `json:"string"`
				} `json:"type"`
				Status struct {
					Value  int    `json:"value"`
					String string `json:"string"`
					Passed bool   `json:"passed"`
				} `json:"status,omitempty"`
				LifetimeHours int `json:"lifetime_hours"`
			} `json:"table"`
			Count              int `json:"count"`
			ErrorCountTotal    int `json:"error_count_total"`
			ErrorCountOutdated int `json:"error_count_outdated"`
		} `json:"standard"`
	} `json:"ata_smart_self_test_log"`
	AtaSmartSelectiveSelfTestLog struct {
		Revision int `json:"revision"`
		Table    []struct {
			LbaMin int `json:"lba_min"`
			LbaMax int `json:"lba_max"`
			Status struct {
				Value  int    `json:"value"`
				String string `json:"string"`
			} `json:"status"`
		} `json:"table"`
		Flags struct {
			Value                int  `json:"value"`
			RemainderScanEnabled bool `json:"remainder_scan_enabled"`
		} `json:"flags"`
		PowerUpScanResumeMinutes int `json:"power_up_scan_resume_minutes"`
	} `json:"ata_smart_selective_self_test_log"`
}

// SMART was used for storing all Devices data
type SMART struct {
	Port       string       `json:"Port"`
	DriveSmart *DeviceSMART `json:"SMART"`
}

// DiskSmartInit Desktop script initiation
func system_disk_smart_init() {
	log.Println("Starting SMART mointoring")
	if !(fileExists("system/disk/smart/win/smartctl.exe") || fileExists("system/disk/smart/linux/smartctl_arm") || fileExists("system/disk/smart/linux/smartctl_arm64") || fileExists("system/disk/smart/linux/smartctl_i386")) {
		if build_version == "development" {
			log.Fatal("[SMART Mointoring] One or more binary not found.")
		} else {
			panic("[SMART Mointoring] One or more binary not found.")
		}

	}
	if runtime.GOOS == "windows" {
		SystemSmartExecutable = "./system/disk/smart/win/smartctl.exe"
	} else if runtime.GOOS == "linux" {
		if runtime.GOARCH == "arm" {
			SystemSmartExecutable = "./system/disk/smart/linux/smartctl_armv6"
		}
		if runtime.GOARCH == "arm64" {
			SystemSmartExecutable = "./system/disk/smart/linux/smartctl_armv6"
		}
		if runtime.GOARCH == "386" {
			SystemSmartExecutable = "./system/disk/smart/linux/smartctl_i386"
		}
		if runtime.GOARCH == "amd64" {
			SystemSmartExecutable = "./system/disk/smart/linux/smartctl_i386"
		}
	} else {
		if build_version == "development" {
			//log.Fatal("[SMART Mointoring] This webApp can't run on imcompitiable environment")
		} else {
			panic("[SMART Mointoring] This webApp can't run on imcompitiable environment")
		}

	}
	//Register all the required API
	http.HandleFunc("/SystemAO/disk/smart/smart.system", ShowIndex)
	http.HandleFunc("/SystemAO/disk/smart/log.system", Showlog)
	http.HandleFunc("/SystemAO/disk/smart/table.system", ShowTable)
	http.HandleFunc("/SystemAO/disk/smart/dotest.system", doDiskTest)
	http.HandleFunc("/SystemAO/disk/smart/readInfo", checkDiskTestStatus)

	//Only allow SMART under sudo moude
	if (sudo_mode){
		//Register as a system setting
		registerSetting(settingModule{
			Name:     "Disk SMART",
			Desc:     "HardDisk Health Checking",
			IconPath: "SystemAO/disk/smart/img/small_icon.png",
			Group:    "Disk",
			StartDir: "SystemAO/disk/smart/smart.system",
			RequireAdmin: true,
		})

		registerSetting(settingModule{
			Name:     "SMART Log",
			Desc:     "HardDisk Health Log",
			IconPath: "SystemAO/disk/smart/img/small_icon.png",
			Group:    "Disk",
			StartDir: "SystemAO/disk/smart/log.system",
			RequireAdmin: true,
		})
	}
	
}

// ReadSMART xxx
func ReadSMART() []SMART {
	if time.Now().Unix()-lastScanTime > 30 {
		SMARTInformation = []SMART{}
		//Scan disk
		cmd := exec.Command(SystemSmartExecutable, "--scan", "--json=c")
		out, _ := cmd.CombinedOutput()
		Devices := new(DevicesList)
		DevicesOutput := string(out)
		json.Unmarshal([]byte(DevicesOutput), &Devices)
		for _, element := range Devices.Devices {
			//Load SMART for each drive
			cmd := exec.Command(SystemSmartExecutable, "-i", element.Name, "-a", "--json=c")
			out, _ = cmd.CombinedOutput()
			InvSMARTInformation := new(DeviceSMART)
			SMARTOutput := string(out)
			json.Unmarshal([]byte(SMARTOutput), &InvSMARTInformation)
			if len(InvSMARTInformation.Smartctl.Messages) > 0 {
				if InvSMARTInformation.Smartctl.Messages[0].Severity == "error" {
					log.Println("[SMART Mointoring] Disk " + element.Name + " cannot be readed")
				} else {
					//putting everything into that struct array
					n := SMART{Port: element.Name, DriveSmart: InvSMARTInformation}
					SMARTInformation = append(SMARTInformation, n)
				}
			} else {
				//putting everything into that struct array
				n := SMART{Port: element.Name, DriveSmart: InvSMARTInformation}
				SMARTInformation = append(SMARTInformation, n)
			}

		}
		lastScanTime = time.Now().Unix()
	}
	return SMARTInformation
}

// ShowIndex is use for reading disk smart
func ShowIndex(w http.ResponseWriter, r *http.Request) {
	//Check if user has logged in
	if system_auth_chkauth(w, r) == false {
		redirectToLoginPage(w, r)
		return
	}
	//create HTML element
	MainHTML := ""
	for _, info := range ReadSMART() {
		//FOR MAIN TAB
		temperatureF := fmt.Sprintf("%.2f", 1.8*float64(info.DriveSmart.Temperature.Current)+32)
		SMARTAval := ""
		if len(info.DriveSmart.AtaSmartAttributes.Table) == 0 {
			SMARTAval = "No"
		} else {
			SMARTAval = "Yes"
		}
		MainHTML += "<div class=\"item\" ondblclick=\"showSMART()\" onClick=\"selected(this);\" diskid=\"" + info.Port + "\" location=\"" + "This Device" + "\" temperature=\"" + strconv.Itoa(info.DriveSmart.Temperature.Current) + "°C | " + temperatureF + "°F" + "\" serial_number=\"" + info.DriveSmart.SerialNumber + "\" firmware_version=\"" + info.DriveSmart.FirmwareVersion + "\" smart=\"" + SMARTAval + "\">"
		MainHTML += "<div class=\"ts comments\">"
		MainHTML += "<div class=\"comment\" style=\"cursor:pointer;width:98vw\">"
		MainHTML += "<div class=\"avatar\"><i class=\"big disk outline icon\"></i></div>"
		MainHTML += "<div class=\"avatar\" style=\"position:absolute; right:60px;top:12px;\"><i  name=\"arrow\" class=\"large chevron down icon\"></i></div>"
		MainHTML += "<div class=\"content\">"
		MainHTML += "<p class=\"author\">" + info.Port + "</p>"
		MainHTML += "<div class=\"text\">" + info.DriveSmart.ModelName + " , " + disksizeConvert(info.DriveSmart.UserCapacity.Bytes) + "</div>"
		MainHTML += "</div>"
		MainHTML += "</div>"
		MainHTML += "</div>"
		MainHTML += "</div>"

	}
	//check if MainHTML is empty
	if MainHTML == "" {
		MainHTML += "<div class=\"item\">"
		MainHTML += "<div class=\"ts comments\">"
		MainHTML += "<div class=\"comment\" style=\"cursor:pointer;width:98vw\">"
		MainHTML += "<div class=\"avatar\"><i class=\"big caution sign icon\"></i></div>"
		MainHTML += "<div class=\"content\">"
		MainHTML += "<p class=\"author\">No disk was found on this system</p>"
		MainHTML += "<div class=\"text\">Please make sure your disk installed correctly</div>"
		MainHTML += "</div>"
		MainHTML += "</div>"
		MainHTML += "</div>"
		MainHTML += "</div>"
	}

	//push assembled data to page
	parsedPage, err := template_load("web/SystemAO/disk/smart/smart.system", map[string]interface{}{
		"html_result": string(MainHTML),
	})

	if err != nil {
		log.Println("Error. Unable to parse smart page.")
	}

	//send!
	sendTextResponse(w, parsedPage)
}

// Showlog xxx
func Showlog(w http.ResponseWriter, r *http.Request) {
	//Check if user has logged in
	if system_auth_chkauth(w, r) == false {
		redirectToLoginPage(w, r)
		return
	}
	//create HTML element
	LogHTML := ""
	for _, info := range ReadSMART() {
		// FOR LOG TAB
		for _, logInfo := range info.DriveSmart.AtaSmartSelfTestLog.Standard.Table {
			LogHTML += "<tr>"
			LogHTML += "<td class=\"collapsing\">" + info.DriveSmart.ModelName + "</td>"
			LogHTML += "<td>" + info.DriveSmart.SerialNumber + "</td>"
			LogHTML += "<td>" + info.Port + "</td>"
			LogHTML += "<td>" + logInfo.Type.String + " - " + logInfo.Status.String + "</td>"
			LogHTML += "</tr>"
		}
	}

	//push assembled data to page
	parsedPage, err := template_load("web/SystemAO/disk/smart/log.system", map[string]interface{}{
		"log_result": string(LogHTML),
	})

	if err != nil {
		log.Println("Error. Unable to parse smart page.")
	}

	//send!
	sendTextResponse(w, parsedPage)
}

// ShowTable xxx
func ShowTable(w http.ResponseWriter, r *http.Request) {
	//Check if user has logged in
	if system_auth_chkauth(w, r) == false {
		redirectToLoginPage(w, r)
		return
	}
	disks, ok := r.URL.Query()["disk"]

	if !ok || len(disks[0]) < 1 {
		log.Println("Parameter DISK not found.")
		return
	}
	//create HTML element
	HTML := ""
	for _, info := range ReadSMART() {
		if info.Port == disks[0] {
			HTML = ""
			for _, column := range info.DriveSmart.AtaSmartAttributes.Table {
				HTML += "<tr><td>" + strconv.Itoa(column.ID) + "</td><td>" + column.Name + "</td><td>" + strconv.Itoa(column.Value) + "</td><td>" + strconv.Itoa(column.Worst) + "</td><td>" + strconv.Itoa(column.Raw.Value) + "</td></tr>"
			}
		}
	}

	//push assembled data to page
	parsedPage, err := template_load("web/SystemAO/disk/smart/table.system", map[string]interface{}{
		"html_result": HTML,
		"disk":        disks[0],
	})

	if err != nil {
		log.Println("Error. Unable to parse smart page.")
	}

	//send!
	sendTextResponse(w, parsedPage)
}

// ShowTable xxx
func doDiskTest(w http.ResponseWriter, r *http.Request) {
	//Check if user has logged in
	if system_auth_chkauth(w, r) == false {
		redirectToLoginPage(w, r)
		return
	}
	disks, ok := r.URL.Query()["disk"]
	if !ok || len(disks[0]) < 1 {
		log.Println("Parameter DISK not found.")
		return
	}

	//push assembled data to page
	parsedPage, err := template_load("web/SystemAO/disk/smart/dotest.system", map[string]interface{}{
		"disk": disks[0],
	})

	if err != nil {
		log.Println("Error. Unable to parse smart page.")
	}

	//send!
	sendTextResponse(w, parsedPage)
}

func checkDiskTestStatus(w http.ResponseWriter, r *http.Request) {
	//Check if user has logged in
	if system_auth_chkauth(w, r) == false {
		redirectToLoginPage(w, r)
		return
	}
	disks, ok := r.URL.Query()["disk"]
	if !ok || len(disks[0]) < 1 {
		log.Println("Parameter DISK not found.")
		return
	}

	DiskTestStatus := new(DeviceSMART)
	for _, info := range ReadSMART() {
		if info.Port == disks[0] {
			DiskTestStatus = info.DriveSmart
		}
	}
	JSONStr, _ := json.Marshal(DiskTestStatus.AtaSmartData.SelfTest.Status)
	//send!
	sendTextResponse(w, string(JSONStr))
}

func disksizeConvert(b int64) string {
	const unit = 1000
	if b == 0 {
		return "Unknown"
	}
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB",
		float64(b)/float64(div), "kMGTPE"[exp])
}
