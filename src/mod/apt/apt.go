package apt

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

/*
	Pacakge management tool for Linux OS with APT

	ONLY USABLE under Linux environment
*/

type AptPackageManager struct {
	AllowAutoInstall bool
}

func NewPackageManager(autoInstall bool) *AptPackageManager {
	logger.DebugTrace("apt", "NewPackageManager")
	return &AptPackageManager{
		AllowAutoInstall: autoInstall,
	}
}

// Install the given package if not exists. Set mustComply to true for "panic on failed to install"
func (a *AptPackageManager) InstallIfNotExists(pkgname string, mustComply bool) (out0 error) {
	defer logger.Out1(logger.In3("apt", "AptPackageManager.InstallIfNotExists", "a", a, "pkgname", pkgname, "mustComply", mustComply), &out0)
	//Clear the pkgname
	pkgname = strings.ReplaceAll(pkgname, "&", "")
	pkgname = strings.ReplaceAll(pkgname, "|", "")

	if !a.AllowAutoInstall {
		return errors.New("package auto install is disabled")
	}

	installed, err := PackageExists(pkgname)
	if err != nil {
		logger.DebugErr("apt", err)
		logger.PrintAndLog("Apt", err.Error(), nil)
	}

	if installed {
		return nil
	}

	//Package not installed. Install if now if running in sudo mode
	logger.PrintAndLog("Apt", "Installing package "+pkgname+"...", nil)
	cmd := exec.Command("apt-get", "install", "-y", pkgname)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	err = cmd.Run()
	if err != nil {
		logger.DebugErr("apt", err)
		if mustComply {
			//Panic and terminate server process
			logger.PrintAndLog("Apt", "Installation failed on package: "+pkgname, nil)
			os.Exit(1)
		} else {
			logger.PrintAndLog("Apt", "Installation failed on package: "+pkgname, nil)
		}
		return err
	}
	return nil
}

func PackageExists(pkgname string) (out0 bool, out1 error) {
	defer logger.Out2(logger.In1("apt", "PackageExists", "pkgname", pkgname), &out0, &out1)
	if runtime.GOOS == "windows" {
		//Check if the command already exists in windows path paramters.
		cmd := exec.Command("where.exe", pkgname, "2>", "nul")
		_, err := cmd.CombinedOutput()
		if err != nil {
			logger.DebugErr("apt", err)
			return false, errors.New("Package " + pkgname + " not found in Windows %PATH%.")
		}
		return true, nil
	} else if runtime.GOOS == "darwin" {
		//Mac OS. Check if package exists
		cmd := exec.Command("whereis", pkgname)
		out, err := cmd.CombinedOutput()
		if err != nil {
			logger.DebugErr("apt", err)
			return false, errors.New("Package " + pkgname + " not found in MacOS ENV variable.")
		}

		if strings.TrimSpace(string(out)) == "" {
			//Package not found by whereis. Try brew
			cmd := exec.Command("bash", "-c", "brew list | grep "+pkgname)
			out, err = cmd.CombinedOutput()
			if err != nil {
				logger.DebugErr("apt", err)
				return false, errors.New("Package " + pkgname + " not found in MacOS ENV variable.")
			}
		}
		if strings.TrimSpace(string(out)) != "" {
			//Exists!
			return true, nil
		} else {
			return false, errors.New("Package " + pkgname + " not installed on this Mac")
		}

	} else if runtime.GOOS == "linux" {
		cmd := exec.Command("which", pkgname)
		out, _ := cmd.CombinedOutput()

		if len(string(out)) > 1 {
			return true, nil
		} else {
			return false, errors.New("Package " + pkgname + " not installed on this Linux Host")
		}

	} else {
		return false, errors.New("unsupported Platform")
	}
}

func HandlePackageListRequest(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In1("apt", "HandlePackageListRequest", "r", r))
	if runtime.GOOS == "windows" {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("{\"error\":\"" + "Function disabled on Windows" + "\"}"))
		return
	}
	cmd := exec.Command("apt", "list", "--installed")
	out, err := cmd.CombinedOutput()
	if err != nil {
		logger.DebugErr("apt", err)
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
}
