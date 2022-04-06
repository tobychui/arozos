package fuzzy

import (
	"strings"
)

/*
	fuzzy.go
	Author: tobychui

	This logic is designed to handle fuzzy logic change similar to Google search engine
	You can fill in string with fuzzy keywords.

	Assume there are two files:
	Hello World.txt
	Hello World not this.txt

	Use fuzzyInput of: World Hello -"not this" .txt
	will return "Hello World.txt" as match only

*/

type Matcher struct {
	caseSensitive bool
	matchList     []string
	excludeList   []string
}

func NewFuzzyMatcher(fuzzyInput string, caseSensitive bool) *Matcher {
	m, e := buildFuzzyChunks(fuzzyInput, caseSensitive)
	return &Matcher{
		caseSensitive: caseSensitive,
		matchList:     m,
		excludeList:   e,
	}
}

func (m *Matcher) Match(filename string) bool {
	if !m.caseSensitive {
		filename = strings.ToLower(filename)
	}

	//All keyword in matchList must be satisfied
	for _, keyword := range m.matchList {
		if !strings.Contains(filename, keyword) {
			return false
		}
	}

	//Check if contain exclude words
	for _, exclude := range m.excludeList {
		if strings.Contains(filename, exclude) {
			return false
		}
	}
	return true
}

//Check if a fuzzyKey require precise searching
func buildFuzzyChunks(fuzzyInput string, caseSensitive bool) ([]string, []string) {
	includeList := []string{}
	excludeList := []string{}
	preciseExclude := false //Exclude precise word from buffer
	preciseBuffer := []string{}

	if !caseSensitive {
		fuzzyInput = strings.ToLower(fuzzyInput)
	}

	fuzzyChunks := strings.Split(fuzzyInput, " ")
	for _, thisChunk := range fuzzyChunks {
		if len(thisChunk) > 0 && thisChunk[:1] == "\"" && thisChunk[len(thisChunk)-1:] == "\"" {
			//This chunk start and end with exact "", just trim the " away
			//Example: "asd"
			includeList = append(includeList, thisChunk[1:len(thisChunk)-1])
		} else if len(thisChunk) > 1 && thisChunk[:1] == "-" && thisChunk[1:2] == "\"" {
			// Example: -"asd

			if thisChunk[len(thisChunk)-1:] == "\"" {
				//-"asd", push directly into exclude list
				excludeList = append(excludeList, thisChunk[2:len(thisChunk)-1])
			} else {
				preciseExclude = true
				preciseBuffer = append(preciseBuffer, thisChunk[2:])
			}

		} else if len(thisChunk) > 0 && thisChunk[:1] == "\"" {
			//Starting of precise string
			//Example (start of): "asd asd"
			preciseBuffer = append(preciseBuffer, thisChunk[1:])
		} else if len(thisChunk) > 0 && thisChunk[len(thisChunk)-1:] == "\"" {
			//End of precise string
			//Example (end of): "asd asd"
			preciseBuffer = append(preciseBuffer, thisChunk[:len(thisChunk)-1])
			tmp := strings.Join(preciseBuffer, " ")
			if preciseExclude {
				excludeList = append(excludeList, tmp)
			} else {
				includeList = append(includeList, tmp)
			}
			//Reset precisebuf
			preciseExclude = false
			preciseBuffer = []string{}
		} else if len(thisChunk) > 0 && thisChunk[:1] == "-" {
			//Example: -asd
			excludeList = append(excludeList, thisChunk[1:])
		} else {
			includeList = append(includeList, thisChunk)
		}
	}

	return includeList, excludeList
}
