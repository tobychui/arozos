package authlogger

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"time"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

type summaryDate []string

func (s summaryDate) Len() int {
	logger.DebugTrace("auth/authlogger", "summaryDate.Len")
	return len(s)
}
func (s summaryDate) Swap(i, j int) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("auth/authlogger", "summaryDate.Swap: i=%d j=%d", i, j)
	}
	s[i], s[j] = s[j], s[i]
}
func (s summaryDate) Less(i, j int) bool {
	if logger.IsDebugTrace() {
		logger.DebugTracef("auth/authlogger", "summaryDate.Less: i=%d j=%d", i, j)
	}
	layout := "Jan-2006"
	timei, err := time.Parse(layout, s[i])
	if err != nil {
		logger.PrintAndLog("Authlogger", fmt.Sprint(err), nil)
	}
	timej, err := time.Parse(layout, s[j])
	if err != nil {
		logger.PrintAndLog("Authlogger", fmt.Sprint(err), nil)
	}
	return timei.Unix() > timej.Unix()
}

// Handle of listing of the logger index (months)
func (l *Logger) HandleIndexListing(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("auth/authlogger", "Logger.HandleIndexListing: r=%s", logger.RequestSummary(r))
	}
	indexes := l.ListSummary()
	sort.Sort(summaryDate(indexes))
	js, err := json.Marshal(indexes)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendJSONResponse(w, string(js))
}

// Handle of the listing of a given index (month)
func (l *Logger) HandleTableListing(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("auth/authlogger", "Logger.HandleTableListing: r=%s", logger.RequestSummary(r))
	}
	//Get the record name request for listing
	month, err := utils.PostPara(r, "record")
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	records, err := l.ListRecords(month)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Filter the records before sending it to web UI
	results := []LoginRecord{}
	for _, record := range records {
		//Replace the username with a regex filtered one
		reg, _ := regexp.Compile("[^a-zA-Z0-9]+")
		filteredUsername := reg.ReplaceAllString(record.TargetUsername, "░")
		record.TargetUsername = filteredUsername
		results = append(results, record)
	}

	js, _ := json.Marshal(results)
	utils.SendJSONResponse(w, string(js))
}
