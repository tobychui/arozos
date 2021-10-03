package fssort

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type sortBufferedStructure struct {
	Filename string
	Filepath string
	Filesize int64
	ModTime  int64
}

/*
	Quick utilties to sort file list according to different modes
*/
func SortFileList(filelistRealpath []string, sortMode string) []string {
	//Build a filelist with information based on the given filelist
	parsedFilelist := []*sortBufferedStructure{}
	for _, file := range filelistRealpath {
		thisFileInfo := sortBufferedStructure{
			Filename: filepath.Base(file),
			Filepath: file,
		}

		//Get Filesize
		fi, err := os.Stat(file)
		if err != nil {
			thisFileInfo.Filesize = 0
		} else {
			thisFileInfo.Filesize = fi.Size()
			thisFileInfo.ModTime = fi.ModTime().Unix()
		}

		parsedFilelist = append(parsedFilelist, &thisFileInfo)

	}

	//Sort the filelist
	if sortMode == "default" {
		//Sort by name, convert filename to window sorting methods
		sort.Slice(parsedFilelist, func(i, j int) bool {
			return strings.ToLower(parsedFilelist[i].Filename) < strings.ToLower(parsedFilelist[j].Filename)
		})
	} else if sortMode == "reverse" {
		//Sort by reverse name
		sort.Slice(parsedFilelist, func(i, j int) bool {
			return strings.ToLower(parsedFilelist[i].Filename) > strings.ToLower(parsedFilelist[j].Filename)
		})
	} else if sortMode == "smallToLarge" {
		sort.Slice(parsedFilelist, func(i, j int) bool { return parsedFilelist[i].Filesize < parsedFilelist[j].Filesize })
	} else if sortMode == "largeToSmall" {
		sort.Slice(parsedFilelist, func(i, j int) bool { return parsedFilelist[i].Filesize > parsedFilelist[j].Filesize })
	} else if sortMode == "mostRecent" {
		sort.Slice(parsedFilelist, func(i, j int) bool { return parsedFilelist[i].ModTime > parsedFilelist[j].ModTime })
	} else if sortMode == "leastRecent" {
		sort.Slice(parsedFilelist, func(i, j int) bool { return parsedFilelist[i].ModTime < parsedFilelist[j].ModTime })
	}

	results := []string{}
	for _, sortedFile := range parsedFilelist {
		results = append(results, sortedFile.Filepath)
	}

	return results
}

func SortModeIsSupported(sortMode string) bool {
	if !contains(sortMode, []string{"default", "reverse", "smallToLarge", "largeToSmall", "mostRecent", "leastRecent"}) {
		return false
	}
	return true
}

func contains(item string, slice []string) bool {
	set := make(map[string]struct{}, len(slice))
	for _, s := range slice {
		set[s] = struct{}{}
	}

	_, ok := set[item]
	return ok
}
