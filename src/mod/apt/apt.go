package apt

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

/*
	Pacakge management tool for Linux OS with APT

	ONLY USABLE under Linux environment
*/

type AptPackageManager struct {
	AllowAutoInstall bool
}

func NewPackageManager(autoInstall bool) *AptPackageManager {
	return &AptPackageManager{
		AllowAutoInstall: autoInstall,
	}
}

//Install the given package if not exists. Set mustComply to true for "panic on failed to install"
func (a *AptPackageManager) InstallIfNotExists(pkgname string, mustComply bool) error {
	//Clear the pkgname
	pkgname = strings.ReplaceAll(pkgname, "&", "")
	pkgname = strings.ReplaceAll(pkgname, "|", "")

	if runtime.GOOS == "windows" {
		//Check if the command already exists in windows path paramters.
		cmd := exec.Command("where", pkgname, "2>", "nul")
		_, err := cmd.CombinedOutput()
		if err != nil {
			return errors.New("Package " + pkgname + " not found in Windows %PATH%.")
		}
		return nil
	} else if runtime.GOOS == "darwin" {
		//Mac OS. Check if package exists
		cmd := exec.Command("whereis", pkgname)
		out, err := cmd.CombinedOutput()
		if err != nil {
			return errors.New("Package " + pkgname + " not found in MacOS ENV variable.")
		}

		if strings.TrimSpace(string(out)) == "" {
			//Package not exists
			return errors.New("Package " + pkgname + " not installed on this Mac")
		}
		return nil
	}

	if a.AllowAutoInstall == false {
		return errors.New("Package auto install is disabled")
	}

	cmd := exec.Command("which", pkgname)
	out, _ := cmd.CombinedOutput()

	//log.Println(packageInfo)
	if len(string(out)) > 1 {
		return nil
	} else {
		//Package not installed. Install if now if running in sudo mode
		log.Println("Installing package " + pkgname + "...")
		cmd := exec.Command("apt-get", "install", "-y", pkgname)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		err := cmd.Run()
		if err != nil {
			if mustComply {
				//Panic and terminate server process
				log.Println("Installation failed on package: "+pkgname, string(out))
				os.Exit(0)
			} else {
				log.Println("Installation failed on package: " + pkgname)
				log.Println(string(out))
			}
			return err
		}
		return nil
	}

	return nil
}

func HandlePackageListRequest(w http.ResponseWriter, r *http.Request) {
	if runtime.GOOS == "windows" {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("{\"error\":\"" + "Function disabled on Windows" + "\"}"))
		return
	}
	cmd := exec.Command("apt", "list", "--installed")
	out, err := cmd.CombinedOutput()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("{\"error\":\"" + err.Error() + "\"}"))
		return
	}

	results := [][]string{}
	//Parse the output string
	installedPackages := strings.Split(string(out), "\n")
	for _, thisPackage := range installedPackages {
		if len(thisPackage) > 0 {
			packageInfo := strings.Split(thisPackage, "/")
			packageName := packageInfo[0]
			if len(packageInfo) >= 2 {
				packageVersion := strings.Split(packageInfo[1], ",")[1]
				if packageVersion[:3] == "now" {
					packageVersion = packageVersion[4:]
				}
				if strings.Contains(packageVersion, "[installed") && packageVersion[len(packageVersion)-1:] != "]" {
					packageVersion = packageVersion + ",automatic]"
				}

				results = append(results, []string{packageName, packageVersion})
			}
		}
	}

	jsonString, _ := json.Marshal(results)
	w.Header().Set("Content-Type", "application/json")
	w.Write(jsonString)
	return
}
