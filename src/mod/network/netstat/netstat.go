package netstat

import (
	"encoding/json"
	"errors"
	"io/ioutil"
	"net/http"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/common"
)

func HandleGetNetworkInterfaceStats(w http.ResponseWriter, r *http.Request) {
	rx, tx, err := GetNetworkInterfaceStats()
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}

	currnetNetSpec := struct {
		RX int64
		TX int64
	}{
		rx,
		tx,
	}

	js, _ := json.Marshal(currnetNetSpec)
	common.SendJSONResponse(w, string(js))
}

//Get network interface stats, return accumulated rx bits, tx bits and error if any
func GetNetworkInterfaceStats() (int64, int64, error) {
	if runtime.GOOS == "windows" {
		cmd := exec.Command("wmic", "path", "Win32_PerfRawData_Tcpip_NetworkInterface", "Get", "BytesReceivedPersec,BytesSentPersec,BytesTotalPersec")
		out, err := cmd.Output()
		if err != nil {
			return 0, 0, err
		}

		//Filter out the first line

		lines := strings.Split(strings.ReplaceAll(string(out), "\r\n", "\n"), "\n")
		if len(lines) >= 2 && len(lines[1]) >= 0 {
			dataLine := lines[1]
			for strings.Contains(dataLine, "  ") {
				dataLine = strings.ReplaceAll(dataLine, "  ", " ")
			}
			dataLine = strings.TrimSpace(dataLine)
			info := strings.Split(dataLine, " ")
			if len(info) < 3 {
				return 0, 0, errors.New("Invalid wmic results")
			}
			rxString := info[0]
			txString := info[1]

			rx := int64(0)
			tx := int64(0)
			if s, err := strconv.ParseInt(rxString, 10, 64); err == nil {
				rx = s
			}

			if s, err := strconv.ParseInt(txString, 10, 64); err == nil {
				tx = s
			}

			//log.Println(rx, tx)
			return rx * 4, tx * 4, nil
		} else {
			//Invalid data
			return 0, 0, errors.New("Invalid wmic results")
		}

	} else if runtime.GOOS == "linux" {
		allIfaceRxByteFiles, err := filepath.Glob("/sys/class/net/*/statistics/rx_bytes")
		if err != nil {
			//Permission denied
			return 0, 0, errors.New("Access denied")
		}

		if len(allIfaceRxByteFiles) == 0 {
			return 0, 0, errors.New("No valid iface found")
		}

		rxSum := int64(0)
		txSum := int64(0)
		for _, rxByteFile := range allIfaceRxByteFiles {
			rxBytes, err := ioutil.ReadFile(rxByteFile)
			if err == nil {
				rxBytesInt, err := strconv.Atoi(strings.TrimSpace(string(rxBytes)))
				if err == nil {
					rxSum += int64(rxBytesInt)
				}
			}

			//Usually the tx_bytes file is nearby it. Read it as well
			txByteFile := filepath.Join(filepath.Dir(rxByteFile), "tx_bytes")
			txBytes, err := ioutil.ReadFile(txByteFile)
			if err == nil {
				txBytesInt, err := strconv.Atoi(strings.TrimSpace(string(txBytes)))
				if err == nil {
					txSum += int64(txBytesInt)
				}
			}

		}

		//Return value as bits
		return rxSum * 8, txSum * 8, nil

	} else if runtime.GOOS == "darwin" {
		cmd := exec.Command("netstat", "-ib") //get data from netstat -ib
		out, err := cmd.Output()
		if err != nil {
			return 0, 0, err
		}

		outStrs := string(out)                                                          //byte array to multi-line string
		for _, outStr := range strings.Split(strings.TrimSuffix(outStrs, "\n"), "\n") { //foreach multi-line string
			if strings.HasPrefix(outStr, "en") { //search for ethernet interface
				if strings.Contains(outStr, "<Link#") { //search for the link with <Link#?>
					outStrSplit := strings.Fields(outStr) //split by white-space

					rxSum, errRX := strconv.Atoi(outStrSplit[6]) //received bytes sum
					if errRX != nil {
						return 0, 0, errRX
					}

					txSum, errTX := strconv.Atoi(outStrSplit[9]) //transmitted bytes sum
					if errTX != nil {
						return 0, 0, errTX
					}

					return int64(rxSum) * 8, int64(txSum) * 8, nil
				}
			}
		}

		return 0, 0, nil //no ethernet adapters with en*/<Link#*>
	}

	return 0, 0, errors.New("Platform not supported")
}
