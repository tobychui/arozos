package updates

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"runtime"
	"time"

	"github.com/gorilla/websocket"
	"imuslab.com/arozos/mod/utils"
)

type UpdateConfig struct {
	Vendor string `json:"vendor"`
	Binary struct {
		Windows struct {
			Amd64 string `json:"amd64"`
			Arm   string `json:"arm"`
			Arm64 string `json:"arm64"`
			I386  string `json:"i386"`
		} `json:"windows"`
		Linux struct {
			Arm    string `json:"arm"`
			Armv7  string `json:"armv7"`
			Arm64  string `json:"arm64"`
			Amd64  string `json:"amd64"`
			Mipsle string `json:"mipsle"`
		} `json:"linux"`
		Darwin struct {
			Amd64 string `json:"amd64"`
			Arm64 string `json:"arm64"`
		} `json:"darwin"`
		Freebsd struct {
			Amd64 string `json:"amd64"`
			Arm   string `json:"arm"`
			Arm64 string `json:"arm64"`
			I386  string `json:"i386"`
		} `json:"freebsd"`
	} `json:"binary"`
	Webpack  string `json:"webpack"`
	Checksum string `json:"checksum"`
}

func HandleUpdateCheckSize(w http.ResponseWriter, r *http.Request) {
	webpack, err := utils.PostPara(r, "webpack")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid or empty webpack download URL")
		return
	}

	binary, err := utils.PostPara(r, "binary")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid or empty binary download URL")
		return
	}

	bsize, wsize, err := GetUpdateSizes(binary, webpack)
	if err != nil {
		utils.SendErrorResponse(w, "Failed to get update size: "+err.Error())
		return
	}

	js, _ := json.Marshal([]int{bsize, wsize})
	utils.SendJSONResponse(w, string(js))
}

func HandleUpdateDownloadRequest(w http.ResponseWriter, r *http.Request) {
	webpack, err := utils.GetPara(r, "webpack")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid or empty webpack download URL")
		return
	}

	binary, err := utils.GetPara(r, "binary")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid or empty binary download URL")
		return
	}

	checksum, err := utils.PostPara(r, "checksum")
	if err != nil {
		checksum = ""
	}

	//Update the connection to websocket
	requireWebsocket, _ := utils.GetPara(r, "ws")
	if requireWebsocket == "true" {
		//Upgrade to websocket
		var upgrader = websocket.Upgrader{}
		upgrader.CheckOrigin = func(r *http.Request) bool { return true }
		c, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			utils.SendErrorResponse(w, "Upgrade websocket failed: "+err.Error())
			return
		}

		type Progress struct {
			Stage      int
			Progress   float64
			StatusText string
		}
		err = DownloadUpdatesFromURL(binary, webpack, checksum, func(stage int, progress float64, statusText string) {
			thisProgress := Progress{
				Stage:      stage,
				Progress:   progress,
				StatusText: statusText,
			}
			js, _ := json.Marshal(thisProgress)
			c.WriteMessage(1, js)
		})
		if err != nil {
			//Finish with error
			c.WriteMessage(1, []byte("{\"error\":\""+err.Error()+"\"}"))
		} else {
			//Done without error
			c.WriteMessage(1, []byte("OK"))
		}

		//Close WebSocket connection after finished
		c.WriteControl(8, []byte{}, time.Now().Add(time.Second))
		c.Close()

	} else {
		//Just download and return ok after finish
		err = DownloadUpdatesFromURL(binary, webpack, checksum, func(stage int, progress float64, statusText string) {
			fmt.Println("Downloading Update, Stage: ", stage, " Progress: ", progress, " Status: ", statusText)
		})
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
		} else {
			utils.SendOK(w)
		}
	}

}

//Handle getting information for vendor update
func HandleGetUpdatePlatformInfo(w http.ResponseWriter, r *http.Request) {
	type UpdatePackageInfo struct {
		Config UpdateConfig
		OS     string
		ARCH   string
	}

	//Check if update config find. If yes, parse that
	updateFileContent, err := ioutil.ReadFile("./system/update.json")
	if err != nil {
		utils.SendErrorResponse(w, "No vendor update config found")
		return
	}

	//Read from the update config
	vendorUpdateConfig := UpdateConfig{}
	err = json.Unmarshal(updateFileContent, &vendorUpdateConfig)
	if err != nil {
		log.Println("[Updates] Failed to parse update config file: ", err.Error())
		utils.SendErrorResponse(w, "Invalid or corrupted update config")
		return
	}

	updateinfo := UpdatePackageInfo{
		Config: vendorUpdateConfig,
		OS:     runtime.GOOS,
		ARCH:   runtime.GOARCH,
	}

	js, _ := json.Marshal(updateinfo)
	utils.SendJSONResponse(w, string(js))
}

//Handle check if there is a pending update
func HandlePendingCheck(w http.ResponseWriter, r *http.Request) {
	if utils.FileExists("./updates/") && utils.FileExists("./updates/web/") && utils.FileExists("./updates/system/") {
		//Update is pending
		utils.SendJSONResponse(w, "true")
	} else {
		utils.SendJSONResponse(w, "false")
	}
}
