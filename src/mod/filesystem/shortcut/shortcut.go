package shortcut

import (
	"errors"
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/utils"
)

/*
	A simple package to better handle shortcuts in ArozOS

	Author: tobychui
*/

func ReadShortcut(shortcutContent []byte) (*arozfs.ShortcutData, error) {
	//Split the content of the shortcut files into lines
	fileContent := strings.ReplaceAll(strings.TrimSpace(string(shortcutContent)), "\r\n", "\n")
	lines := strings.Split(fileContent, "\n")

	if len(lines) < 4 {
		return nil, errors.New("Corrupted Shortcut File")
	}

	for i := 0; i < len(lines); i++ {
		lines[i] = strings.TrimSpace(lines[i])
	}

	//Render it as shortcut data
	result := arozfs.ShortcutData{
		Type: lines[0],
		Name: lines[1],
		Path: lines[2],
		Icon: lines[3],
	}

	return &result, nil
}

//Generate the content of a shortcut base the the four important field of shortcut information
func GenerateShortcutBytes(shortcutTarget string, shortcutType string, shortcutText string, shortcutIcon string) []byte {
	//Check if there are desktop icon. If yes, override icon on module
	if shortcutType == "module" && utils.FileExists(arozfs.ToSlash(filepath.Join("./web/", filepath.Dir(shortcutIcon), "/desktop_icon.png"))) {
		shortcutIcon = arozfs.ToSlash(filepath.Join(filepath.Dir(shortcutIcon), "/desktop_icon.png"))
	}

	//Clean the shortcut text
	shortcutText = arozfs.FilterIllegalCharInFilename(shortcutText, " ")
	return []byte(shortcutType + "\n" + shortcutText + "\n" + shortcutTarget + "\n" + shortcutIcon)
}
