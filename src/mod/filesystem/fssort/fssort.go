package fssort

import (
	"io/fs"
	"path/filepath"
	"sort"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

type sortBufferedStructure struct {
	Filename string
	Filepath string
	Filesize int64
	ModTime  int64
}

var ValidSortModes = []string{"default", "reverse", "smallToLarge", "largeToSmall", "mostRecent", "leastRecent", "smart", "fileTypeAsce", "fileTypeDesc"}

/*
Quick utilties to sort file list according to different modes
*/
func SortFileList(filelistRealpath []string, fileInfos []fs.FileInfo, sortMode string) (out0 []string) {
	defer logger.Out1(logger.In3("filesystem/fssort", "SortFileList", "filelistRealpath", filelistRealpath, "fileInfos", fileInfos, "sortMode", sortMode), &out0)
	//Build a filelist with information based on the given filelist
	parsedFilelist := []*sortBufferedStructure{}
	if len(filelistRealpath) != len(fileInfos) {
		//Invalid usage
		return filelistRealpath
	}
	for i, file := range filelistRealpath {
		thisFileInfo := sortBufferedStructure{
			Filename: filepath.Base(file),
			Filepath: file,
		}

		//Get Filesize
		fi := fileInfos[i]
		thisFileInfo.Filesize = fi.Size()
		thisFileInfo.ModTime = fi.ModTime().Unix()

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
		sort.Slice(parsedFilelist, func(i, j int) bool {
			if parsedFilelist[i].ModTime == parsedFilelist[j].ModTime {
				return strings.ToLower(parsedFilelist[i].Filename) < strings.ToLower(parsedFilelist[j].Filename)
			}
			return parsedFilelist[i].ModTime > parsedFilelist[j].ModTime

		})
	} else if sortMode == "leastRecent" {
		sort.Slice(parsedFilelist, func(i, j int) bool {
			if parsedFilelist[i].ModTime == parsedFilelist[j].ModTime {
				return strings.ToLower(parsedFilelist[i].Filename) > strings.ToLower(parsedFilelist[j].Filename)
			}
			return parsedFilelist[i].ModTime < parsedFilelist[j].ModTime
		})
	} else if sortMode == "smart" {
		parsedFilelist = SortNaturalFilelist(parsedFilelist)
	} else if sortMode == "fileTypeAsce" {
		sort.Slice(parsedFilelist, func(i, j int) bool {
			exti := filepath.Ext(parsedFilelist[i].Filename)
			extj := filepath.Ext(parsedFilelist[j].Filename)

			exti = strings.TrimPrefix(exti, ".")
			extj = strings.TrimPrefix(extj, ".")

			return exti < extj

		})
	} else if sortMode == "fileTypeDesc" {
		sort.Slice(parsedFilelist, func(i, j int) bool {
			exti := filepath.Ext(parsedFilelist[i].Filename)
			extj := filepath.Ext(parsedFilelist[j].Filename)

			exti = strings.TrimPrefix(exti, ".")
			extj = strings.TrimPrefix(extj, ".")

			return exti > extj

		})
	}

	results := []string{}
	for _, sortedFile := range parsedFilelist {
		results = append(results, sortedFile.Filepath)
	}

	return results
}

func SortDirEntryList(dirEntries []fs.DirEntry, sortMode string) (out0 []fs.DirEntry) {
	defer logger.Out1(logger.In2("filesystem/fssort", "SortDirEntryList", "dirEntries", dirEntries, "sortMode", sortMode), &out0)
	entries := map[string]fs.DirEntry{}
	fnames := []string{}
	fis := []fs.FileInfo{}

	for _, de := range dirEntries {
		fnames = append(fnames, de.Name())
		fstat, _ := de.Info()
		fis = append(fis, fstat)
		thisFsDirEntry := de
		entries[de.Name()] = thisFsDirEntry
	}

	//Sort it
	sortedNameList := SortFileList(fnames, fis, sortMode)

	//Update dirEntry sequence
	newDirEntry := []fs.DirEntry{}
	for _, key := range sortedNameList {
		newDirEntry = append(newDirEntry, entries[key])
	}

	return newDirEntry
}

func SortModeIsSupported(sortMode string) (out0 bool) {
	defer logger.Out1(logger.In1("filesystem/fssort", "SortModeIsSupported", "sortMode", sortMode), &out0)
	return contains(sortMode, ValidSortModes)
}

func contains(item string, slice []string) (out0 bool) {
	defer logger.Out1(logger.In2("filesystem/fssort", "contains", "item", item, "slice", slice), &out0)
	set := make(map[string]struct{}, len(slice))
	for _, s := range slice {
		set[s] = struct{}{}
	}

	_, ok := set[item]
	return ok
}
