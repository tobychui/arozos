package main

import (
	"encoding/json"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"imuslab.com/arozos/mod/utils"
)

// localeFileSchema is the top-level structure shared by all locale JSON files.
type localeFileSchema struct {
	Author string                     `json:"author"`
	Keys   map[string]localeKeyEntry  `json:"keys"`
}

type localeKeyEntry struct {
	Name string `json:"name"`
}

// InfoHandleGetLocaleInfo returns locale coverage statistics.
// It reads every JSON file under ./web/SystemAO/locale/ (one level of sub-dirs),
// uses file_explorer.json as the canonical language baseline, and reports:
//   - coverage % per language (how many files have that language)
//   - a deduplicated contributors list
func InfoHandleGetLocaleInfo(w http.ResponseWriter, r *http.Request) {
	type LanguageEntry struct {
		Code       string  `json:"code"`
		Name       string  `json:"name"`
		FileCount  int     `json:"fileCount"`
		TotalFiles int     `json:"totalFiles"`
		Coverage   float64 `json:"coverage"`
	}
	type Response struct {
		Languages    []LanguageEntry `json:"languages"`
		Contributors []string        `json:"contributors"`
		TotalFiles   int             `json:"totalFiles"`
	}

	localeRoot := "./web/SystemAO/locale"

	// ── 1. Collect all JSON file paths (root + one level of sub-dirs) ──────────
	var jsonFiles []string
	entries, err := os.ReadDir(localeRoot)
	if err != nil {
		utils.SendErrorResponse(w, "Failed to read locale directory: "+err.Error())
		return
	}
	for _, e := range entries {
		if e.IsDir() {
			subEntries, err2 := os.ReadDir(filepath.Join(localeRoot, e.Name()))
			if err2 != nil {
				continue
			}
			for _, se := range subEntries {
				if !se.IsDir() && filepath.Ext(se.Name()) == ".json" {
					jsonFiles = append(jsonFiles, filepath.Join(localeRoot, e.Name(), se.Name()))
				}
			}
		} else if filepath.Ext(e.Name()) == ".json" {
			jsonFiles = append(jsonFiles, filepath.Join(localeRoot, e.Name()))
		}
	}

	// ── 2. Parse file_explorer.json to get the baseline language set ────────────
	baseData, err := os.ReadFile(filepath.Join(localeRoot, "file_explorer.json"))
	if err != nil {
		utils.SendErrorResponse(w, "Failed to read file_explorer.json: "+err.Error())
		return
	}
	var base localeFileSchema
	if err = json.Unmarshal(baseData, &base); err != nil {
		utils.SendErrorResponse(w, "Failed to parse file_explorer.json: "+err.Error())
		return
	}

	// Build a map: langCode -> display name (from file_explorer.json)
	langNames := make(map[string]string, len(base.Keys))
	for code, entry := range base.Keys {
		langNames[code] = entry.Name
	}

	// ── 3. Walk every JSON file, tally language presence and collect authors ────
	langFileCounts := make(map[string]int, len(langNames))
	contributorsSet := make(map[string]bool)

	for _, path := range jsonFiles {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var lf localeFileSchema
		if err = json.Unmarshal(data, &lf); err != nil {
			continue
		}
		for _, part := range strings.Split(lf.Author, ",") {
			part = strings.TrimSpace(part)
			if part != "" {
				contributorsSet[part] = true
			}
		}
		for code := range lf.Keys {
			if _, isBaseLang := langNames[code]; isBaseLang {
				langFileCounts[code]++
			}
		}
	}

	totalFiles := len(jsonFiles)

	// ── 4. Build sorted language list ──────────────────────────────────────────
	languages := make([]LanguageEntry, 0, len(langNames))
	for code, name := range langNames {
		count := langFileCounts[code]
		coverage := 0.0
		if totalFiles > 0 {
			coverage = math.Round(float64(count)/float64(totalFiles)*1000) / 10
		}
		languages = append(languages, LanguageEntry{
			Code:       code,
			Name:       name,
			FileCount:  count,
			TotalFiles: totalFiles,
			Coverage:   coverage,
		})
	}
	sort.Slice(languages, func(i, j int) bool {
		if languages[i].Coverage != languages[j].Coverage {
			return languages[i].Coverage > languages[j].Coverage
		}
		return languages[i].Code < languages[j].Code
	})

	// ── 5. Build sorted contributors list ──────────────────────────────────────
	contributors := make([]string, 0, len(contributorsSet))
	for c := range contributorsSet {
		contributors = append(contributors, c)
	}
	sort.Strings(contributors)

	resp := Response{
		Languages:    languages,
		Contributors: contributors,
		TotalFiles:   totalFiles,
	}
	js, _ := json.Marshal(resp)
	utils.SendJSONResponse(w, string(js))
}
