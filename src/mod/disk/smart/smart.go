package smart

/*
	DISK SMART Service Listener
	Original author: alanyeung
	Rewritten by tobychui in Oct 2020 for system arch upgrade

	This module is not the core part of aroz online system.
	If you want to remove disk smart handler (e.g. running in VM?)
	remove the corrisponding code in disk.go
*/

import (
	"encoding/json"
	"log"
	"net/http"
	"os/exec"
	"runtime"
	"errors"
	"time"
)

// SMART was used for storing all Devices data
type SMART struct {
	Port       string       `json:"Port"`
	DriveSmart *DeviceSMART `json:"SMART"`
}

type SMARTListener struct{
	SystemSmartExecutable string
	LastScanTime int64
	SMARTInformation []*SMART
	ReadingInProgress bool
}

// DiskSmartInit Desktop script initiation
func NewSmartListener() (*SMARTListener, error){
	var SystemSmartExecutable string = ""

	log.Println("Starting SMART mointoring")
	if !(fileExists("system/disk/smart/win/smartctl.exe") || fileExists("system/disk/smart/linux/smartctl_arm") || fileExists("system/disk/smart/linux/smartctl_arm64") || fileExists("system/disk/smart/linux/smartctl_i386")) {
		return &SMARTListener{}, errors.New("Smartctl.exe not found")
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
		return &SMARTListener{}, errors.New("Not supported platform")
	}
	return &SMARTListener{
		SystemSmartExecutable: SystemSmartExecutable,
		LastScanTime: 0,
		SMARTInformation: []*SMART{},
		ReadingInProgress: false,
	},nil
}

// ReadSMART xxx
func (s *SMARTListener)ReadSMART() []*SMART {
	if time.Now().Unix()-s.LastScanTime > 30 {
		if (s.ReadingInProgress == false){
			//Set reading flag to true
			s.ReadingInProgress = true;
			s.SMARTInformation = []*SMART{}
			//Scan disk
			cmd := exec.Command(s.SystemSmartExecutable, "--scan", "--json=c")
			out, _ := cmd.CombinedOutput()
			Devices := new(DevicesList)
			DevicesOutput := string(out)
			json.Unmarshal([]byte(DevicesOutput), &Devices)
			for _, element := range Devices.Devices {
				//Load SMART for each drive
				cmd := exec.Command(s.SystemSmartExecutable, "-i", element.Name, "-a", "--json=c")
				out, err := cmd.CombinedOutput()
				if err != nil{
					//log.Println(string(out), err);
				}
				InvSMARTInformation := new(DeviceSMART)
				SMARTOutput := string(out)
				json.Unmarshal([]byte(SMARTOutput), &InvSMARTInformation)
				if len(InvSMARTInformation.Smartctl.Messages) > 0 {
					if InvSMARTInformation.Smartctl.Messages[0].Severity == "error" {
						log.Println("[SMART Mointoring] Disk " + element.Name + " cannot be readed")
					} else {
						//putting everything into that struct array
						n := SMART{Port: element.Name, DriveSmart: InvSMARTInformation}
						s.SMARTInformation = append(s.SMARTInformation, &n)
					}
				} else {
					//putting everything into that struct array
					n := SMART{Port: element.Name, DriveSmart: InvSMARTInformation}
					s.SMARTInformation = append(s.SMARTInformation, &n)
				}

			}
			s.LastScanTime = time.Now().Unix()

			//Set reading flag to false
			s.ReadingInProgress = false;
		}
	}
	return s.SMARTInformation
}

func (s *SMARTListener)GetSMART(w http.ResponseWriter, r *http.Request) {
	jsonText, _ := json.Marshal(s.ReadSMART())
	sendJSONResponse(w, string(jsonText))
}

func (s *SMARTListener)CheckDiskTable(w http.ResponseWriter, r *http.Request) {
	disks, ok := r.URL.Query()["disk"]
	if !ok || len(disks[0]) < 1 {
		log.Println("Parameter DISK not found.")
		return
	}

	DiskStatus := new(DeviceSMART)
	for _, info := range s.ReadSMART() {
		if info.Port == disks[0] {
			DiskStatus = info.DriveSmart
		}
	}
	JSONStr, _ := json.Marshal(DiskStatus.AtaSmartAttributes.Table)
	//send!
	sendJSONResponse(w, string(JSONStr))
}

func (s *SMARTListener)CheckDiskTestStatus(w http.ResponseWriter, r *http.Request) {
	disks, ok := r.URL.Query()["disk"]
	if !ok || len(disks[0]) < 1 {
		log.Println("Parameter DISK not found.")
		return
	}

	DiskTestStatus := new(DeviceSMART)
	for _, info := range s.ReadSMART() {
		if info.Port == disks[0] {
			DiskTestStatus = info.DriveSmart
		}
	}
	JSONStr, _ := json.Marshal(DiskTestStatus.AtaSmartData.SelfTest.Status)
	//send!
	sendJSONResponse(w, string(JSONStr))
}
