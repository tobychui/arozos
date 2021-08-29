package shortcut

import (
	"errors"
	"io/ioutil"
	"strings"

	"imuslab.com/arozos/mod/common"
)

/*
	A simple package to better handle shortcuts in ArozOS

	Author: tobychui
*/

//A shortcut representing struct
type ShortcutData struct {
	Type string //The type of shortcut
	Name string //The name of the shortcut
	Path string //The path of shortcut
	Icon string //The icon of shortcut
}

func ReadShortcut(shortcutFile string) (*ShortcutData, error) {
	if common.FileExists(shortcutFile) {
		content, err := ioutil.ReadFile(shortcutFile)
		if err != nil {
			return nil, err
		}

		//Split the content of the shortcut files into lines
		fileContent := strings.ReplaceAll(strings.TrimSpace(string(content)), "\r\n", "\n")
		lines := strings.Split(fileContent, "\n")

		if len(lines) < 4 {
			return nil, errors.New("Corrupted Shortcut File")
		}

		for i := 0; i < len(lines); i++ {
			lines[i] = strings.TrimSpace(lines[i])
		}

		//Render it as shortcut data
		result := ShortcutData{
			Type: lines[0],
			Name: lines[1],
			Path: lines[2],
			Icon: lines[3],
		}

		return &result, nil
	} else {
		return nil, errors.New("File not exists.")
	}
}
