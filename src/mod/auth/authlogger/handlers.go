package authlogger

import (
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"sort"
	"time"
)

type summaryDate []string

func (s summaryDate) Len() int {
	return len(s)
}
func (s summaryDate) Swap(i, j int) {
	s[i], s[j] = s[j], s[i]
}
func (s summaryDate) Less(i, j int) bool {
	layout := "Jan-2006"
	timei, err := time.Parse(layout, s[i])
	if err != nil {
		log.Println(err)
	}
	timej, err := time.Parse(layout, s[j])
	if err != nil {
		log.Println(err)
	}
	return timei.Unix() > timej.Unix()
}

//Handle of listing of the logger index (months)
func (l *Logger) HandleIndexListing(w http.ResponseWriter, r *http.Request) {
	indexes := l.ListSummary()
	sort.Sort(summaryDate(indexes))
	js, err := json.Marshal(indexes)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	sendJSONResponse(w, string(js))
}

//Handle of the listing of a given index (month)
func (l *Logger) HandleTableListing(w http.ResponseWriter, r *http.Request) {
	//Get the record name request for listing
	month, err := mv(r, "record", true)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	records, err := l.ListRecords(month)
	if err != nil {
		sendErrorResponse(w, err.Error())
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
	sendJSONResponse(w, string(js))
}
