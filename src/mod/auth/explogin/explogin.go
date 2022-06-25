package explogin

import (
	"errors"
	"math"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

/*
	Explogin.go
	Package to handle expotential login time
	so as to prevent someone from brute forcing your password

	Author: tobychui
*/

type UserLoginEntry struct {
	Username             string //Username of account
	TargetIP             string //Request IP address
	PreviousTryTimestamp int64  //Previous failed attempt timestamp
	NextAllowedTimestamp int64  //Next allowed login timestamp
	RetryCount           int    //Retry count total before success login
}

type ExpLoginHandler struct {
	LoginRecord  *sync.Map //Sync map to store UserLoginEntry, username+ip as key
	BaseDelay    int       //Base delay exponent
	DelayCeiling int       //Max delay time
}

//Create a new exponential login handler object
func NewExponentialLoginHandler(baseDelay int, ceiling int) *ExpLoginHandler {
	recordMap := sync.Map{}

	return &ExpLoginHandler{
		LoginRecord:  &recordMap,
		BaseDelay:    baseDelay,
		DelayCeiling: ceiling,
	}
}

//Check allow access now, if false return how many seconds till next retry
func (e *ExpLoginHandler) AllowImmediateAccess(username string, r *http.Request) (bool, int64) {
	userip, err := getIpFromRequest(r)
	if err != nil {
		//No ip information. Use 0.0.0.0
		userip = "0.0.0.0"
	}

	//Get the login entry from sync map
	key := username + "/" + userip
	val, ok := e.LoginRecord.Load(key)
	if !ok {
		//No record found for this user. Allow immediate access
		return true, 0
	}

	//Record exists. Check his retry count and target
	targerRecord := val.(*UserLoginEntry)
	if targerRecord.NextAllowedTimestamp > time.Now().Unix() {
		//Return next login request time left in seconds
		return false, targerRecord.NextAllowedTimestamp - time.Now().Unix()
	}

	//Ok to login now
	return true, 0
}

//Add a user retry count after failed login
func (e *ExpLoginHandler) AddUserRetrycount(username string, r *http.Request) {
	userip, err := getIpFromRequest(r)
	if err != nil {
		//No ip information. Use 0.0.0.0
		userip = "0.0.0.0"
	}

	key := username + "/" + userip
	val, ok := e.LoginRecord.Load(key)
	if !ok {
		//Create an entry for the retry
		thisUserNewRecord := UserLoginEntry{
			Username:             username,
			TargetIP:             userip,
			PreviousTryTimestamp: time.Now().Unix(),
			NextAllowedTimestamp: time.Now().Unix() + e.getDelayTimeFromRetryCount(1),
			RetryCount:           1,
		}

		e.LoginRecord.Store(key, &thisUserNewRecord)
	} else {
		//Add to the value in the structure
		matchingLoginEntry := val.(*UserLoginEntry)
		matchingLoginEntry.RetryCount++
		matchingLoginEntry.PreviousTryTimestamp = time.Now().Unix()
		matchingLoginEntry.NextAllowedTimestamp = time.Now().Unix() + e.getDelayTimeFromRetryCount(matchingLoginEntry.RetryCount)

		//Store it back to the map
		e.LoginRecord.Store(key, matchingLoginEntry)
	}
}

//Reset a user retry count after successful login
func (e *ExpLoginHandler) ResetUserRetryCount(username string, r *http.Request) {
	userip, err := getIpFromRequest(r)
	if err != nil {
		//No ip information. Use 0.0.0.0
		userip = "0.0.0.0"
	}

	key := username + "/" + userip
	e.LoginRecord.Delete(key)
}

//Reset all Login exponential record
func (e *ExpLoginHandler) ResetAllUserRetryCounter() {
	e.LoginRecord.Range(func(key interface{}, value interface{}) bool {
		e.LoginRecord.Delete(key)
		return true
	})
}

//Get the next delay time
func (e *ExpLoginHandler) getDelayTimeFromRetryCount(retryCount int) int64 {
	delaySecs := int64(math.Floor((math.Pow(2, float64(retryCount)) - 1) * 0.5))
	if delaySecs > int64(e.DelayCeiling)-int64(e.BaseDelay) {
		delaySecs = int64(e.DelayCeiling) - int64(e.BaseDelay)
	}

	return int64(e.BaseDelay) + delaySecs
}

/*

	Helper functions

*/

func getIpFromRequest(r *http.Request) (string, error) {
	ip := r.Header.Get("X-REAL-IP")
	netIP := net.ParseIP(ip)
	if netIP != nil {
		return ip, nil
	}

	ips := r.Header.Get("X-FORWARDED-FOR")
	splitIps := strings.Split(ips, ",")
	for _, ip := range splitIps {
		netIP := net.ParseIP(ip)
		if netIP != nil {
			return ip, nil
		}
	}

	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return "", err
	}
	netIP = net.ParseIP(ip)
	if netIP != nil {
		return ip, nil
	}
	return "", errors.New("No IP information found")
}
