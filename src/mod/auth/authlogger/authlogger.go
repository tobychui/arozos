package authlogger

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

/*
	AuthLogger
	Author: tobychui

	This module help log the login request and help the user to trace who is trying
	to break into their system.

*/

type Logger struct {
	database *database.Database
}

type LoginRecord struct {
	Timestamp      int64
	TargetUsername string
	LoginSucceed   bool
	IpAddr         string
	AuthType       string
	Port           int
}

// New Logger create a new logger object
func NewLogger() (out0 *Logger, out1 error) {
	defer logger.Out2(logger.In0("auth/authlogger", "NewLogger"), &out0, &out1)
	os.MkdirAll("./system/auth/", 0775)
	db, err := database.NewDatabase("./system/auth/authlog.db", false)
	if err != nil {
		logger.DebugErr("auth/authlogger", err)
		return nil, errors.New("*ERROR* Failed to create database for login tracking: " + err.Error())
	}
	return &Logger{
		database: db,
	}, nil
}

// Log the current authentication to record, Require the request object and login status
func (l *Logger) LogAuth(r *http.Request, loginStatus bool) (out0 error) {
	defer logger.Out1(logger.In3("auth/authlogger", "Logger.LogAuth", "l", l, "r", r, "loginStatus", loginStatus), &out0)
	username, _ := utils.PostPara(r, "username")
	timestamp := time.Now().Unix()
	//handling the reverse proxy remote IP issue
	remoteIP := r.Header.Get("X-FORWARDED-FOR")
	if remoteIP != "" {
		//grab the last known remote IP from header
		remoteIPs := strings.Split(remoteIP, ", ")
		remoteIP = remoteIPs[len(remoteIPs)-1]
	} else {
		//if there is no X-FORWARDED-FOR, use default remote IP
		remoteIP = r.RemoteAddr
	}
	return l.LogAuthByRequestInfo(username, remoteIP, timestamp, loginStatus, "web")
}

// Log the current authentication to record by custom filled information. Use LogAuth if your module is authenticating via web interface
func (l *Logger) LogAuthByRequestInfo(username string, remoteAddr string, timestamp int64, loginSucceed bool, authType string) (out0 error) {
	defer logger.Out1(logger.In6("auth/authlogger", "Logger.LogAuthByRequestInfo", "l", l, "username", username, "remoteAddr", remoteAddr, "timestamp", timestamp, "loginSucceed", loginSucceed, "!authType", authType), &out0)
	//Get the current month as the table name, create table if not exists
	current := time.Now().UTC()
	tableName := current.Format("Jan-2006")

	//Create table if not exists
	if !l.database.TableExists(tableName) {
		l.database.NewTable(tableName)
	}

	//Split the remote address into ipaddr and port
	remoteAddrInfo := []string{"unknown", "N/A"}
	if strings.Contains(remoteAddr, ":") {
		//For general IPv4  address
		remoteAddrInfo = strings.Split(remoteAddr, ":")
	}

	//Check for IPV6
	if strings.Contains(remoteAddr, "[") && strings.Contains(remoteAddr, "]") {
		//This is an IPV6 address. Rewrite the split
		//IPv6 should have the format of something like this [::1]:80
		ipv6info := strings.Split(remoteAddr, ":")
		port := ipv6info[len(ipv6info)-1:]
		ipAddr := ipv6info[:len(ipv6info)-1]
		remoteAddrInfo = []string{strings.Join(ipAddr, ":"), strings.Join(port, ":")}

	}

	port := -1
	if len(remoteAddrInfo) > 1 {
		port, _ = strconv.Atoi(remoteAddrInfo[1])
	}

	//Create the entry log struct
	thisRecord := LoginRecord{
		Timestamp:      timestamp,
		TargetUsername: username,
		LoginSucceed:   loginSucceed,
		IpAddr:         remoteAddrInfo[0],
		AuthType:       authType,
		Port:           port,
	}

	//Write the log to it
	entryKey := strconv.Itoa(int(time.Now().UnixNano()))
	err := l.database.Write(tableName, entryKey, thisRecord)
	if err != nil {
		logger.DebugErr("auth/authlogger", err)
		logger.PrintAndLog("Authlogger", "*ERROR* Failed to write authentication log. Is the storage fulled?", nil)
		logger.PrintAndLog("Authlogger", err.Error(), nil)
		return err
	}

	return nil

}

// Close the database when system shutdown
func (l *Logger) Close() {
	logger.DebugTrace("auth/authlogger", "Logger.Close")
	l.database.Close()
}

// List the total number of months recorded in the database
func (l *Logger) ListSummary() (out0 []string) {
	defer logger.Out1(logger.In1("auth/authlogger", "Logger.ListSummary", "l", l), &out0)
	tableNames := []string{}
	l.database.Tables.Range(func(tableName, _ interface{}) bool {
		tableNames = append(tableNames, tableName.(string))
		return true
	})

	return tableNames
}

func (l *Logger) ListRecords(key string) (out0 []LoginRecord, out1 error) {
	defer logger.Out2(logger.In2("auth/authlogger", "Logger.ListRecords", "l", l, "!key", key), &out0, &out1)
	results := []LoginRecord{}
	if l.database.TableExists(key) {
		//Read all record from the database to login records
		entries, err := l.database.ListTable(key)
		if err != nil {
			logger.DebugErr("auth/authlogger", err)
			return results, err
		}

		for _, keypairs := range entries {
			record := LoginRecord{}
			json.Unmarshal(keypairs[1], &record)
			results = append(results, record)
		}

		return results, nil
	} else {
		return results, errors.New("Table not exists")
	}
}

// Extract the address information from the request object, the first one is the remote address from the last hop,
// and the 2nd one is the source address filled in by the client (not accurate)
func getIpAddressFromRequest(r *http.Request) (out0 string, out1 []string) {
	defer logger.Out2(logger.In1("auth/authlogger", "getIpAddressFromRequest", "r", r), &out0, &out1)
	lastHopAddress := r.RemoteAddr
	possibleSourceAddress := []string{}
	rawHeader := r.Header.Get("X-Forwarded-For")
	possibleSourceAddress = strings.Split(rawHeader, ", ")

	return lastHopAddress, possibleSourceAddress
}
