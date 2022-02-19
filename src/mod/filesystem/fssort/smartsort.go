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
)

func SortNaturalFilelist(filelist []*sortBufferedStructure) []*sortBufferedStructure {
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
