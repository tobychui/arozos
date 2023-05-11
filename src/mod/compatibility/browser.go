package compatibility

import (
	"path/filepath"
	"strconv"
	"strings"
)

/*
	FirefoxBrowserVersionForBypassUploadMetaHeaderCheck

	This function check if Firefox version is between 84 and 93.
	If yes, this function will return TRUE and upload logic should not need to handle
	META header for upload. If FALSE, please extract the relative filepath from the meta header.
	Example Firefox userAgent header:
	Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:94.0) Gecko/20100101 Firefox/94.02021/11/23
*/
func FirefoxBrowserVersionForBypassUploadMetaHeaderCheck(userAgent string) bool {
	if strings.Contains(userAgent, "Mozilla") && strings.Contains(userAgent, "Firefox/") {
		userAgentSegment := strings.Split(userAgent, " ")
		for _, u := range userAgentSegment {
			if len(u) > 4 && strings.TrimSpace(u)[:3] == "rv:" {
				//This is the firefox version code
				versionCode := strings.TrimSpace(u)[3 : len(u)-1]
				vcodeNumeric, err := strconv.ParseFloat(versionCode, 64)
				if err != nil {
					//Unknown version of Firefox. Just check for META anyway
					return false
				}

				if vcodeNumeric >= 84 && vcodeNumeric < 94 {
					//Special versions of Firefox. Do not check for META header
					return true
				} else {
					//Newer or equal to v94. Check it
					return false
				}
			}
		}
	}
	//Not Firefox.
	return true
}

//Handle browser compatibility issue regarding some special format type
func BrowserCompatibilityOverrideContentType(userAgent string, filename string, contentType string) string {
	if strings.Contains(userAgent, "Mozilla") && strings.Contains(userAgent, "Firefox/") {
		//Firefox. Handle specal content-type serving
		if filepath.Ext(filename) == ".ai" {
			//Handle issue #105 for .ai file downloaded as .pdf on Firefox
			//https://github.com/tobychui/arozos/issues/105
			return "application/ai"
		} else if filepath.Ext(filename) == ".apk" {
			return "application/apk"
		} else if filepath.Ext(filename) == ".iso" {
			return "application/x-iso9660-image"
		}
	}
	return contentType
}
