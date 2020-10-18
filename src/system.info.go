package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

// CPUInfoS xxx
type CPUInfoS struct {
	Model       string
	Freq        string
	Instruction string
	Hardware    string
	Revision    string
}

type LogicalDiskS struct {
	DriveLetter string
	FileSystem  string
	FreeSpace   string
}

type ArOZInfoS struct {
	BuildVersion string
	DeviceVendor string
	DeviceModel  string
	VendorIcon   string
	SN           string
}

//InitShowSysInformation xxx
func system_info_serviec_init() {
	log.Println("Operation System: " + runtime.GOOS)
	log.Println("System Architecture: " + runtime.GOARCH)
	if runtime.GOOS == "windows" {
		/*
			//Skip this shit so it will not lag windows server on launch
			log.Println("Windows Version: " + wmicGetinfo("os", "Caption")[0])
			log.Println("Total Memory: " + wmicGetinfo("ComputerSystem", "TotalPhysicalMemory")[0] + "B")
			log.Println("Processor: " + wmicGetinfo("cpu", "Name")[0])
			log.Println("Following disk was detected:")
			for _, info := range wmicGetinfo("diskdrive", "Model") {
				log.Println(info)
			}
		*/

		//this features only working on windows, so display on win at now
		http.HandleFunc("/SystemAO/info/getCPUinfo", getCPUinfo)
		http.HandleFunc("/SystemAO/info/ifconfig", ifconfig)
		http.HandleFunc("/SystemAO/info/getDriveStat", getDriveStat)
		http.HandleFunc("/SystemAO/info/usbPorts", getUSB)
		http.HandleFunc("/SystemAO/info/getRAMinfo", getRAMinfo)

	} else if runtime.GOOS == "linux" {
		//this features only working on windows, so display on win at now
		http.HandleFunc("/SystemAO/info/getCPUinfo", getCPUinfoLinux)
		http.HandleFunc("/SystemAO/info/ifconfig", ifconfigLinux)
		http.HandleFunc("/SystemAO/info/getDriveStat", getDriveStatLinux)
		http.HandleFunc("/SystemAO/info/usbPorts", getUSBLinux)
		http.HandleFunc("/SystemAO/info/getRAMinfo", getRAMinfoLinux)
	}

	http.HandleFunc("/SystemAO/info/getArOZInfo", getArOZInfo)
	//Register as a system setting
	registerSetting(settingModule{
		Name:     "Host Info",
		Desc:     "System Information",
		IconPath: "SystemAO/info/img/small_icon.png",
		Group:    "Info",
		StartDir: "SystemAO/info/index.html",
	})

}

func ifconfigLinux(w http.ResponseWriter, r *http.Request) {
	//Check if user has logged in
	if system_auth_chkauth(w, r) == false {
		redirectToLoginPage(w, r)
		return
	}

	cmdin := `ip link show`
	cmd := exec.Command("bash", "-c", cmdin)
	networkInterfaces, err := cmd.CombinedOutput()
	if err != nil {
		networkInterfaces = []byte{}
	}

	nic := strings.Split(string(networkInterfaces), "\n")

	var arr []string
	for _, info := range nic {
		thisInfo := string(info)
		arr = append(arr, thisInfo)
	}

	var jsonData []byte
	jsonData, err = json.Marshal(arr)
	if err != nil {
		log.Println(err)
	}
	sendTextResponse(w, string(jsonData))
}

func getDriveStatLinux(w http.ResponseWriter, r *http.Request) {
	//Check if user has logged in
	if system_auth_chkauth(w, r) == false {
		redirectToLoginPage(w, r)
		return
	}

	//Get drive status using df command
	cmdin := `df -k | sed -e /Filesystem/d`
	cmd := exec.Command("bash", "-c", cmdin)
	dev, err := cmd.CombinedOutput()
	if err != nil {
		dev = []byte{}
	}

	drives := strings.Split(string(dev), "\n")

	if len(drives) == 0 {
		sendErrorResponse(w, "Invalid disk information")
		return
	}

	var arr []LogicalDiskS
	for _, driveInfo := range drives {
		if driveInfo == "" {
			continue
		}
		for strings.Contains(driveInfo, "  ") {
			driveInfo = strings.Replace(driveInfo, "  ", " ", -1)
		}
		driveInfoChunk := strings.Split(driveInfo, " ")
		freespaceInByte, _ := StringToInt64(driveInfoChunk[3])

		LogicalDisk := LogicalDiskS{
			DriveLetter: driveInfoChunk[5],
			FileSystem:  driveInfoChunk[0],
			FreeSpace:   Int64ToString(freespaceInByte * 1024), //df show disk space in 1KB blocks
		}
		arr = append(arr, LogicalDisk)
	}

	var jsonData []byte
	jsonData, err = json.Marshal(arr)
	if err != nil {
		log.Println(err)
	}
	sendTextResponse(w, string(jsonData))

}

func getUSBLinux(w http.ResponseWriter, r *http.Request) {
	//Check if user has logged in
	if system_auth_chkauth(w, r) == false {
		redirectToLoginPage(w, r)
		return
	}

	cmdin := `lsusb`
	cmd := exec.Command("bash", "-c", cmdin)
	usbd, err := cmd.CombinedOutput()
	if err != nil {
		usbd = []byte{}
	}

	usbDrives := strings.Split(string(usbd), "\n")

	var arr []string
	for _, info := range usbDrives {
		arr = append(arr, info)
	}

	var jsonData []byte
	jsonData, err = json.Marshal(arr)
	if err != nil {
		log.Println(err)
	}
	sendTextResponse(w, string(jsonData))
}

func systemInfoFilterFilterGrepResults(result string, sep string) string {
	if strings.Contains(result, sep) == false {
		return result
	}
	tmp := strings.Split(result, sep)
	resultString := tmp[1]
	return strings.TrimSpace(resultString)
}

func getCPUinfoLinux(w http.ResponseWriter, r *http.Request) {
	//Check if user has logged in
	if system_auth_chkauth(w, r) == false {
		redirectToLoginPage(w, r)
		return
	}

	cmdin := `cat /proc/cpuinfo | grep -m1 "model name"`
	cmd := exec.Command("bash", "-c", cmdin)
	hardware, err := cmd.CombinedOutput()
	if err != nil {
		hardware = []byte("??? ")
	}

	cmdin = `lscpu | grep -m1 "Model name"`
	cmd = exec.Command("bash", "-c", cmdin)
	cpuModel, err := cmd.CombinedOutput()
	if err != nil {
		cpuModel = []byte("Generic Processor")
	}

	cmdin = `lscpu | grep "CPU max MHz"`
	cmd = exec.Command("bash", "-c", cmdin)
	speed, err := cmd.CombinedOutput()
	if err != nil {
		cmdin = `cat /proc/cpuinfo | grep -m1 "cpu MHz"`
		cmd = exec.Command("bash", "-c", cmdin)
		intelSpeed, err := cmd.CombinedOutput()
		if err != nil {
			speed = []byte("??? ")
		}
		speed = intelSpeed
	}

	cmdin = `cat /proc/cpuinfo | grep -m1 "Hardware"`
	cmd = exec.Command("bash", "-c", cmdin)
	cpuhardware, err := cmd.CombinedOutput()
	if err != nil {

	} else {
		hardware = cpuhardware
	}

	//On ARM
	cmdin = `cat /proc/cpuinfo | grep -m1 "Revision"`
	cmd = exec.Command("bash", "-c", cmdin)
	revision, err := cmd.CombinedOutput()
	if err != nil {
		//On x64
		cmdin = `cat /proc/cpuinfo | grep -m1 "family"`
		cmd = exec.Command("bash", "-c", cmdin)
		intelrev, err := cmd.CombinedOutput()
		if err != nil {
			revision = []byte("??? ")
		} else {
			revision = intelrev
		}
	}

	//Get Arch
	cmdin = `uname --m`
	cmd = exec.Command("bash", "-c", cmdin)
	arch, err := cmd.CombinedOutput()
	if err != nil {
		arch = []byte("??? ")
	}

	CPUInfo := CPUInfoS{
		Freq:        systemInfoFilterFilterGrepResults(string(speed), ":"),
		Hardware:    systemInfoFilterFilterGrepResults(string(hardware), ":"),
		Instruction: systemInfoFilterFilterGrepResults(string(arch), ":"),
		Model:       systemInfoFilterFilterGrepResults(string(cpuModel), ":"),
		Revision:    systemInfoFilterFilterGrepResults(string(revision), ":"),
	}

	var jsonData []byte
	jsonData, err = json.Marshal(CPUInfo)
	if err != nil {
		log.Println(err)
	}
	sendTextResponse(w, string(jsonData))
}

func getRAMinfoLinux(w http.ResponseWriter, r *http.Request) {
	cmd := exec.Command("grep", "MemTotal", "/proc/meminfo")
	out, _ := cmd.CombinedOutput()
	strOut := string(out)
	strOut = strings.ReplaceAll(strOut, "MemTotal:", "")
	strOut = strings.ReplaceAll(strOut, "kB", "")
	strOut = strings.ReplaceAll(strOut, " ", "")
	strOut = strings.ReplaceAll(strOut, "\n", "")
	ramSize, _ := strconv.Atoi(strOut)
	ramSizeInt := ramSize * 1000

	var jsonData []byte
	jsonData, err := json.Marshal(ramSizeInt)
	if err != nil {
		log.Println(err)
	}
	sendTextResponse(w, string(jsonData))
}

func getCPUinfo(w http.ResponseWriter, r *http.Request) {
	//Check if user has logged in
	if system_auth_chkauth(w, r) == false {
		redirectToLoginPage(w, r)
		return
	}
	CPUInfo := CPUInfoS{
		Freq:        wmicGetinfo("cpu", "CurrentClockSpeed")[0],
		Hardware:    "unknown",
		Instruction: wmicGetinfo("cpu", "Caption")[0],
		Model:       wmicGetinfo("cpu", "Name")[0],
		Revision:    "unknown",
	}

	var jsonData []byte
	jsonData, err := json.Marshal(CPUInfo)
	if err != nil {
		log.Println(err)
	}
	sendTextResponse(w, string(jsonData))
}

func ifconfig(w http.ResponseWriter, r *http.Request) {
	//Check if user has logged in
	if system_auth_chkauth(w, r) == false {
		redirectToLoginPage(w, r)
		return
	}
	var arr []string
	for _, info := range wmicGetinfo("nic", "ProductName") {
		arr = append(arr, info)
	}

	var jsonData []byte
	jsonData, err := json.Marshal(arr)
	if err != nil {
		log.Println(err)
	}
	sendTextResponse(w, string(jsonData))
}

func getDriveStat(w http.ResponseWriter, r *http.Request) {
	//Check if user has logged in
	if system_auth_chkauth(w, r) == false {
		redirectToLoginPage(w, r)
		return
	}
	var DeviceID []string = wmicGetinfo("logicaldisk", "DeviceID")
	var FileSystem []string = wmicGetinfo("logicaldisk", "FileSystem")
	var FreeSpace []string = wmicGetinfo("logicaldisk", "FreeSpace")

	var arr []LogicalDiskS
	for i, info := range DeviceID {
		LogicalDisk := LogicalDiskS{
			DriveLetter: info,
			FileSystem:  FileSystem[i],
			FreeSpace:   FreeSpace[i],
		}
		arr = append(arr, LogicalDisk)
	}

	var jsonData []byte
	jsonData, err := json.Marshal(arr)
	if err != nil {
		log.Println(err)
	}
	sendTextResponse(w, string(jsonData))
}

func getUSB(w http.ResponseWriter, r *http.Request) {
	//Check if user has logged in
	if system_auth_chkauth(w, r) == false {
		redirectToLoginPage(w, r)
		return
	}
	var arr []string
	for _, info := range wmicGetinfo("Win32_USBHub", "Description") {
		arr = append(arr, info)
	}

	var jsonData []byte
	jsonData, err := json.Marshal(arr)
	if err != nil {
		log.Println(err)
	}
	sendTextResponse(w, string(jsonData))
}

func getRAMinfo(w http.ResponseWriter, r *http.Request) {
	//Check if user has logged in
	if system_auth_chkauth(w, r) == false {
		redirectToLoginPage(w, r)
		return
	}
	var RAMsize int = 0
	for _, info := range wmicGetinfo("memorychip", "Capacity") {
		DIMMCapacity, _ := strconv.Atoi(info)
		RAMsize += DIMMCapacity
	}

	var jsonData []byte
	jsonData, err := json.Marshal(RAMsize)
	if err != nil {
		log.Println(err)
	}
	sendTextResponse(w, string(jsonData))
}

func getArOZInfo(w http.ResponseWriter, r *http.Request) {
	//Check if user has logged in
	if system_auth_chkauth(w, r) == false {
		redirectToLoginPage(w, r)
		return
	}

	ArOZInfo := ArOZInfoS{
		BuildVersion: build_version + "." + internal_version,
		DeviceVendor: deviceVendor,
		DeviceModel:  deviceModel,
		VendorIcon:   "../../" + iconVendor,
		SN:           deviceUUID,
	}

	var jsonData []byte
	jsonData, err := json.Marshal(ArOZInfo)
	if err != nil {
		log.Println(err)
	}
	sendTextResponse(w, string(jsonData))
}

func wmicGetinfo(wmicName string, itemName string) []string {
	//get systeminfo
	var InfoStorage []string

	cmd := exec.Command("chcp", "65001")

	cmd = exec.Command("wmic", wmicName, "list", "full", "/format:list")
	if wmicName == "os" {
		cmd = exec.Command("wmic", wmicName, "get", "*", "/format:list")
	}

	if len(wmicName) > 6 {
		if wmicName[0:6] == "Win32_" {
			cmd = exec.Command("wmic", "path", wmicName, "get", "*", "/format:list")
		}
	}
	out, _ := cmd.CombinedOutput()
	strOut := string(out)

	strSplitedOut := strings.Split(strOut, "\n")
	for _, strConfig := range strSplitedOut {
		if strings.Contains(strConfig, "=") {
			strSplitedConfig := strings.SplitN(strConfig, "=", 2)
			if strSplitedConfig[0] == itemName {
				strSplitedConfigReplaced := strings.Replace(strSplitedConfig[1], "\r", "", -1)
				InfoStorage = append(InfoStorage, strSplitedConfigReplaced)
			}
		}

	}
	if len(InfoStorage) == 0 {
		InfoStorage = append(InfoStorage, "Undefined")
	}
	return InfoStorage
}
