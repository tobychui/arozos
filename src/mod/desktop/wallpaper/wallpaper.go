package wallpaper

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

/*
	wallpaper.go

	Discovery of the desktop wallpapers shipped with ArozOS. Wallpapers are
	grouped into themes, one folder per theme, each holding the background images
	that theme offers.

	Author: tobychui
*/

// SupportedExtensions are the image formats accepted as a desktop wallpaper
var SupportedExtensions = []string{".jpg", ".png", ".gif"}

// Theme is one wallpaper theme folder and the backgrounds it contains
type Theme struct {
	Theme  string
	Bglist []string
}

// ListThemes scans a wallpaper root folder (e.g. "web/img/desktop/bg") and
// returns one Theme per sub-folder, each listing the wallpaper filenames it
// holds. Themes are returned in a stable alphabetical order.
func ListThemes(wallpaperRoot string) ([]Theme, error) {
	themeFolders, err := os.ReadDir(wallpaperRoot)
	if err != nil {
		return nil, err
	}

	themeList := []Theme{}
	for _, themeFolder := range themeFolders {
		if !themeFolder.IsDir() {
			continue
		}

		backgrounds, err := os.ReadDir(filepath.Join(wallpaperRoot, themeFolder.Name()))
		if err != nil {
			//Unreadable theme folder, skip it instead of failing the whole scan
			continue
		}

		var backgroundList []string
		for _, background := range backgrounds {
			if background.IsDir() || !IsSupportedWallpaper(background.Name()) {
				continue
			}
			backgroundList = append(backgroundList, background.Name())
		}

		themeList = append(themeList, Theme{
			Theme:  themeFolder.Name(),
			Bglist: backgroundList,
		})
	}

	sort.Slice(themeList, func(i, j int) bool {
		return themeList[i].Theme < themeList[j].Theme
	})

	return themeList, nil
}

// IsSupportedWallpaper reports whether a filename carries an extension that can
// be used as a desktop wallpaper.
func IsSupportedWallpaper(filename string) bool {
	fileExtension := strings.ToLower(filepath.Ext(filename))
	for _, supportedExtension := range SupportedExtensions {
		if fileExtension == supportedExtension {
			return true
		}
	}
	return false
}
