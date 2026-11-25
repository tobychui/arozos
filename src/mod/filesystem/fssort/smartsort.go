package fssort

/*
	Smart Sort

	Sort file based on natural string sorting logic, design to sort filename
	that contains digit but without zero paddings
*/

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

func SortNaturalFilelist(filelist []*sortBufferedStructure) []*sortBufferedStructure {
	if logger.IsDebug() {
		logger.Debugf("filesystem/fssort", "SortNaturalFilelist: len(filelist)=%d", len(filelist))
	}
	filenameList := []string{}
	filenameMap := map[string]*sortBufferedStructure{}
	for _, file := range filelist {
		filenameList = append(filenameList, file.Filename)
		filenameMap[file.Filename] = file
	}

	sortedFilenameList := sortNaturalStrings(filenameList)
	sortedFileList := []*sortBufferedStructure{}
	for _, thisFilename := range sortedFilenameList {
		sortedFileList = append(sortedFileList, filenameMap[thisFilename])
	}

	return sortedFileList
}

func sortNaturalStrings(array []string) []string {
	if logger.IsDebug() {
		logger.Debugf("filesystem/fssort", "sortNaturalStrings: len(array)=%d", len(array))
	}
	bufKey := []string{}
	bufMap := map[string]string{}
	for _, thisString := range array {
		re := regexp.MustCompile("[0-9]+")
		matchings := re.FindAllString(thisString, -1)
		cs := thisString
		for _, matchPoint := range matchings {
			mpi, _ := strconv.Atoi(matchPoint)
			replacement := fmt.Sprintf("%018d", mpi)
			cs = strings.ReplaceAll(cs, matchPoint, replacement)
		}

		bufKey = append(bufKey, cs)
		bufMap[cs] = thisString
	}

	sort.Strings(bufKey)

	result := []string{}
	for _, key := range bufKey {
		result = append(result, bufMap[key])
	}
	return result
}
