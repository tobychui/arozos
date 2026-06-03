package agi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/utils"
)

// statsTable is the BoltDB table used to persist endpoint execution statistics.
const statsTable = "ext_agi_stats"

// endpointFormat holds the owner and script path for a registered endpoint.
type endpointFormat struct {
	Username string `json:"username"`
	Path     string `json:"path"`
}

// ExecLog holds the details of a single execution attempt.
type ExecLog struct {
	RequestID  string `json:"request_id"`
	Timestamp  int64  `json:"timestamp"`
	DurationMs int64  `json:"duration_ms"`
	Method     string `json:"method"`
	Message    string `json:"message"`
}

// EndpointStats tracks cumulative statistics for a single serverless endpoint.
type EndpointStats struct {
	UUID            string    `json:"uuid"`
	Path            string    `json:"path"`
	TotalExecutions int64     `json:"total_executions"`
	SuccessfulExecs int64     `json:"successful_executions"`
	FailedExecs     int64     `json:"failed_executions"`
	TotalExecTimeMs int64     `json:"total_exec_time_ms"`
	AvgExecTimeMs   float64   `json:"avg_exec_time_ms"`
	LastExecutedAt  int64     `json:"last_executed_at"`
	RecentSuccess   []ExecLog `json:"recent_success"`
	RecentFailed    []ExecLog `json:"recent_failed"`
}

// ── DB helpers ────────────────────────────────────────────────────────────────

// ensureStatsTable creates the stats DB table if it does not yet exist.
func (g *Gateway) ensureStatsTable() {
	sysdb := g.Option.UserHandler.GetDatabase()
	if !sysdb.TableExists(statsTable) {
		sysdb.NewTable(statsTable)
	}
}

// loadStatsFromDB reads persisted EndpointStats for one UUID from BoltDB.
// Returns nil when no record exists or the data cannot be parsed.
// Must NOT be called while holding g.statsMux.
func (g *Gateway) loadStatsFromDB(endpointUUID string) *EndpointStats {
	sysdb := g.Option.UserHandler.GetDatabase()
	if !sysdb.TableExists(statsTable) {
		return nil
	}
	if !sysdb.KeyExists(statsTable, endpointUUID) {
		return nil
	}
	// The DB stores values as JSON-encoded strings; Read() decodes one layer.
	rawJSON := ""
	if err := sysdb.Read(statsTable, endpointUUID, &rawJSON); err != nil {
		return nil
	}
	var s EndpointStats
	if err := json.Unmarshal([]byte(rawJSON), &s); err != nil {
		return nil
	}
	// Ensure slice fields are never nil (avoids JSON "null" in responses).
	if s.RecentSuccess == nil {
		s.RecentSuccess = []ExecLog{}
	}
	if s.RecentFailed == nil {
		s.RecentFailed = []ExecLog{}
	}
	return &s
}

// saveStatsToDB persists the pre-marshalled stats JSON for one endpoint.
// Must NOT be called while holding g.statsMux (to avoid lock contention on I/O).
func (g *Gateway) saveStatsToDB(endpointUUID string, jsonBytes []byte) {
	g.ensureStatsTable()
	sysdb := g.Option.UserHandler.GetDatabase()
	sysdb.Write(statsTable, endpointUUID, string(jsonBytes))
}

// deleteStatsFromDB removes persisted stats for one endpoint.
func (g *Gateway) deleteStatsFromDB(endpointUUID string) {
	sysdb := g.Option.UserHandler.GetDatabase()
	if sysdb.TableExists(statsTable) {
		sysdb.Delete(statsTable, endpointUUID)
	}
}

// ── Core execution tracking ───────────────────────────────────────────────────

// recordExecution updates in-memory stats for endpointUUID after one execution
// and then persists them to BoltDB. Safe for concurrent use.
func (g *Gateway) recordExecution(endpointUUID, path, requestID, method string, durationMs int64, execErr error) {
	g.statsMux.Lock()

	stats, exists := g.endpointStats[endpointUUID]
	if !exists {
		// Cold-start: try to restore from the database before creating a blank entry.
		// loadStatsFromDB must be called without the lock (it doesn't touch the map),
		// but here we release and re-acquire to keep the load outside the lock window.
		g.statsMux.Unlock()
		loaded := g.loadStatsFromDB(endpointUUID)
		g.statsMux.Lock()

		// Re-check in case another goroutine populated it while we were loading.
		if stats, exists = g.endpointStats[endpointUUID]; !exists {
			if loaded != nil {
				stats = loaded
			} else {
				stats = &EndpointStats{
					UUID:          endpointUUID,
					Path:          path,
					RecentSuccess: []ExecLog{},
					RecentFailed:  []ExecLog{},
				}
			}
			g.endpointStats[endpointUUID] = stats
		}
	}

	stats.TotalExecutions++
	stats.TotalExecTimeMs += durationMs
	stats.LastExecutedAt = time.Now().Unix()
	stats.AvgExecTimeMs = float64(stats.TotalExecTimeMs) / float64(stats.TotalExecutions)

	entry := ExecLog{
		RequestID:  requestID,
		Timestamp:  time.Now().Unix(),
		DurationMs: durationMs,
		Method:     method,
	}

	if execErr != nil {
		stats.FailedExecs++
		entry.Message = execErr.Error()
		stats.RecentFailed = append([]ExecLog{entry}, stats.RecentFailed...)
		if len(stats.RecentFailed) > 10 {
			stats.RecentFailed = stats.RecentFailed[:10]
		}
	} else {
		stats.SuccessfulExecs++
		entry.Message = "Execution successful"
		stats.RecentSuccess = append([]ExecLog{entry}, stats.RecentSuccess...)
		if len(stats.RecentSuccess) > 10 {
			stats.RecentSuccess = stats.RecentSuccess[:10]
		}
	}

	// Marshal while still holding the lock so we capture a consistent snapshot.
	jsonBytes, _ := json.Marshal(stats)

	g.statsMux.Unlock()

	// DB write outside the lock to avoid holding it during I/O.
	g.saveStatsToDB(endpointUUID, jsonBytes)
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

// ExtAPIHandler handles incoming requests from external services via
// /api/remote/{UUID}.
func (g *Gateway) ExtAPIHandler(w http.ResponseWriter, r *http.Request) {
	sysdb := g.Option.UserHandler.GetDatabase()

	if !sysdb.TableExists("external_agi") {
		http.Error(w, "invalid API request", http.StatusBadRequest)
		return
	}

	requestURI := filepath.ToSlash(filepath.Clean(r.URL.Path))
	subpathElements := strings.Split(requestURI[1:], "/")

	if len(subpathElements) != 3 {
		http.Error(w, "invalid API request", http.StatusBadRequest)
		return
	}

	endpointUUID := subpathElements[2]
	data, isExist := g.checkIfExternalEndpointExist(endpointUUID)
	if !isExist {
		http.Error(w, "malformed request: invalid UUID given", http.StatusBadRequest)
		return
	}

	usernameFromDb := data.Username
	pathFromDb := data.Path

	userInfo, err := g.Option.UserHandler.GetUserInfoFromUsername(usernameFromDb)
	if err != nil {
		http.Error(w, "invalid request: API author no longer exists", http.StatusBadRequest)
		return
	}
	fsh, realPath, err := static.VirtualPathToRealPath(pathFromDb, userInfo)
	if err != nil {
		http.Error(w, "invalid request: backend script path cannot be resolved", http.StatusBadRequest)
		return
	}

	if !fsh.FileSystemAbstraction.FileExists(realPath) {
		agiLogger.PrintAndLog("Agi", fmt.Sprint("[Remote AGI] ", pathFromDb, " cannot be found on "+realPath), nil)
		http.Error(w, "invalid request: backend script not exists", http.StatusBadRequest)
		return
	}

	// Measure wall-clock duration; the returned execID (assigned by the AGI
	// runtime) is reused as the request ID for execution log tracing.
	start := time.Now()

	execID, result, execErr := g.ExecuteAGIScriptAsUser(fsh, realPath, userInfo, w, r)

	durationMs := time.Since(start).Milliseconds()
	g.recordExecution(endpointUUID, pathFromDb, execID, r.Method, durationMs, execErr)

	if execErr != nil {
		agiLogger.PrintAndLog("Agi", fmt.Sprint("[Remote AGI] ", pathFromDb, " failed to execute", execErr.Error()), nil)
		utils.SendErrorResponse(w, execErr.Error())
		return
	}

	w.Write([]byte(result))
}

// AddExternalEndPoint registers a new serverless endpoint for the current user.
func (g *Gateway) AddExternalEndPoint(w http.ResponseWriter, r *http.Request) {
	userInfo, err := g.Option.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}
	sysdb := g.Option.UserHandler.GetDatabase()
	if !sysdb.TableExists("external_agi") {
		sysdb.NewTable("external_agi")
	}

	path, err := utils.GetPara(r, "path")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid path given")
		return
	}

	id := uuid.NewV4().String()

	var dat endpointFormat
	dat.Path = path
	dat.Username = userInfo.Username

	jsonStr, err := json.Marshal(dat)
	if err != nil {
		utils.SendErrorResponse(w, "Invalid JSON string: "+err.Error())
		return
	}
	sysdb.Write("external_agi", id, string(jsonStr))

	utils.SendJSONResponse(w, "\""+id+"\"")
}

// RemoveExternalEndPoint deletes a registered endpoint by UUID, including its
// persisted statistics.
func (g *Gateway) RemoveExternalEndPoint(w http.ResponseWriter, r *http.Request) {
	userInfo, err := g.Option.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	sysdb := g.Option.UserHandler.GetDatabase()
	if !sysdb.TableExists("external_agi") {
		sysdb.NewTable("external_agi")
	}

	endpointUUID, err := utils.GetPara(r, "uuid")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid uuid given")
		return
	}

	data, isExist := g.checkIfExternalEndpointExist(endpointUUID)
	if !isExist {
		utils.SendErrorResponse(w, "UUID does not exists in the database!")
		return
	}

	if data.Username != userInfo.Username {
		utils.SendErrorResponse(w, "Permission denied")
		return
	}

	// Remove endpoint record and its persisted stats.
	sysdb.Delete("external_agi", endpointUUID)
	g.deleteStatsFromDB(endpointUUID)

	// Clean up in-memory cache.
	g.statsMux.Lock()
	delete(g.endpointStats, endpointUUID)
	g.statsMux.Unlock()

	utils.SendOK(w)
}

// ListExternalEndpoint returns all endpoints registered by the current user.
func (g *Gateway) ListExternalEndpoint(w http.ResponseWriter, r *http.Request) {
	userInfo, err := g.Option.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	sysdb := g.Option.UserHandler.GetDatabase()
	if !sysdb.TableExists("external_agi") {
		sysdb.NewTable("external_agi")
	}

	dataFromDB := make(map[string]endpointFormat)

	entries, err := sysdb.ListTable("external_agi")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid table")
		return
	}
	for _, keypairs := range entries {
		var dataFromResult endpointFormat
		rawJSON := ""
		endpointUUID := string(keypairs[0])
		json.Unmarshal(keypairs[1], &rawJSON)
		json.Unmarshal([]byte(rawJSON), &dataFromResult)
		if dataFromResult.Username == userInfo.Username {
			dataFromDB[endpointUUID] = dataFromResult
		}
	}

	returnJson, err := json.Marshal(dataFromDB)
	if err != nil {
		utils.SendErrorResponse(w, "Invalid JSON: "+err.Error())
		return
	}
	utils.SendJSONResponse(w, string(returnJson))
}

// GetEndpointStats returns execution statistics for all endpoints owned by the
// current user.  For each endpoint the server checks the in-memory cache first;
// on a cache miss it loads from BoltDB so that stats survive process restarts.
// Endpoints that have never been called are included with zeroed counters.
func (g *Gateway) GetEndpointStats(w http.ResponseWriter, r *http.Request) {
	userInfo, err := g.Option.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	sysdb := g.Option.UserHandler.GetDatabase()
	if !sysdb.TableExists("external_agi") {
		utils.SendJSONResponse(w, "{}")
		return
	}

	entries, err := sysdb.ListTable("external_agi")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid table")
		return
	}

	// Collect the UUIDs that belong to this user before touching the lock.
	type epEntry struct {
		uuid string
		path string
	}
	var userEndpoints []epEntry
	for _, keypairs := range entries {
		var ep endpointFormat
		rawJSON := ""
		endpointUUID := string(keypairs[0])
		json.Unmarshal(keypairs[1], &rawJSON)
		json.Unmarshal([]byte(rawJSON), &ep)
		if ep.Username == userInfo.Username {
			userEndpoints = append(userEndpoints, epEntry{endpointUUID, ep.Path})
		}
	}

	// For each endpoint: serve from memory, fall back to DB, or return zeros.
	// We use a write lock because a DB-load may populate the memory cache.
	g.statsMux.Lock()
	result := make(map[string]*EndpointStats, len(userEndpoints))
	for _, ep := range userEndpoints {
		if stats, exists := g.endpointStats[ep.uuid]; exists {
			result[ep.uuid] = stats
		} else {
			// Not in memory — try the database.
			g.statsMux.Unlock()
			dbStats := g.loadStatsFromDB(ep.uuid)
			g.statsMux.Lock()

			// Re-check after re-acquiring the lock.
			if stats, exists = g.endpointStats[ep.uuid]; exists {
				result[ep.uuid] = stats
			} else if dbStats != nil {
				g.endpointStats[ep.uuid] = dbStats
				result[ep.uuid] = dbStats
			} else {
				result[ep.uuid] = &EndpointStats{
					UUID:          ep.uuid,
					Path:          ep.path,
					RecentSuccess: []ExecLog{},
					RecentFailed:  []ExecLog{},
				}
			}
		}
	}
	g.statsMux.Unlock()

	returnJson, err := json.Marshal(result)
	if err != nil {
		utils.SendErrorResponse(w, "Invalid JSON: "+err.Error())
		return
	}
	utils.SendJSONResponse(w, string(returnJson))
}

func (g *Gateway) checkIfExternalEndpointExist(endpointUUID string) (endpointFormat, bool) {
	sysdb := g.Option.UserHandler.GetDatabase()
	if !sysdb.TableExists("external_agi") {
		sysdb.NewTable("external_agi")
	}
	var dat endpointFormat

	if !sysdb.KeyExists("external_agi", endpointUUID) {
		return dat, false
	}

	jsonData := ""
	sysdb.Read("external_agi", endpointUUID, &jsonData)
	json.Unmarshal([]byte(jsonData), &dat)

	return dat, true
}
