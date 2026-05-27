package agi

import (
	"encoding/json"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/utils"
)

// endpointFormat holds the owner and script path for a registered endpoint.
type endpointFormat struct {
	Username string `json:"username"`
	Path     string `json:"path"`
}

// ExecLog holds the details of a single execution attempt.
type ExecLog struct {
	RequestID string `json:"request_id"`
	Timestamp int64  `json:"timestamp"`
	DurationMs int64 `json:"duration_ms"`
	Method    string `json:"method"`
	Message   string `json:"message"`
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

// recordExecution updates in-memory stats for the given endpoint UUID after one
// execution. It is safe to call from multiple goroutines.
func (g *Gateway) recordExecution(endpointUUID, path, requestID, method string, durationMs int64, execErr error) {
	g.statsMux.Lock()
	defer g.statsMux.Unlock()

	stats, exists := g.endpointStats[endpointUUID]
	if !exists {
		stats = &EndpointStats{
			UUID:          endpointUUID,
			Path:          path,
			RecentSuccess: []ExecLog{},
			RecentFailed:  []ExecLog{},
		}
		g.endpointStats[endpointUUID] = stats
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
		// Prepend and keep last 10
		stats.RecentFailed = append([]ExecLog{entry}, stats.RecentFailed...)
		if len(stats.RecentFailed) > 10 {
			stats.RecentFailed = stats.RecentFailed[:10]
		}
	} else {
		stats.SuccessfulExecs++
		entry.Message = "Execution successful"
		// Prepend and keep last 10
		stats.RecentSuccess = append([]ExecLog{entry}, stats.RecentSuccess...)
		if len(stats.RecentSuccess) > 10 {
			stats.RecentSuccess = stats.RecentSuccess[:10]
		}
	}
}

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
		log.Println("[Remote AGI] ", pathFromDb, " cannot be found on "+realPath)
		http.Error(w, "invalid request: backend script not exists", http.StatusBadRequest)
		return
	}

	// Assign a unique request ID for log tracing
	requestID := uuid.NewV4().String()
	start := time.Now()

	result, execErr := g.ExecuteAGIScriptAsUser(fsh, realPath, userInfo, w, r)

	durationMs := time.Since(start).Milliseconds()
	g.recordExecution(endpointUUID, pathFromDb, requestID, r.Method, durationMs, execErr)

	if execErr != nil {
		log.Println("[Remote AGI] ", pathFromDb, " failed to execute", execErr.Error())
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

// RemoveExternalEndPoint deletes a registered endpoint by UUID.
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

	sysdb.Delete("external_agi", endpointUUID)

	// Also clean up in-memory stats for this endpoint
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
// current user. Endpoints that have never been called are included with zeroed
// counters so the UI always has a complete picture.
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

	g.statsMux.RLock()
	defer g.statsMux.RUnlock()

	result := make(map[string]*EndpointStats)
	for _, keypairs := range entries {
		var dataFromResult endpointFormat
		rawJSON := ""
		endpointUUID := string(keypairs[0])
		json.Unmarshal(keypairs[1], &rawJSON)
		json.Unmarshal([]byte(rawJSON), &dataFromResult)

		if dataFromResult.Username != userInfo.Username {
			continue
		}

		if stats, exists := g.endpointStats[endpointUUID]; exists {
			result[endpointUUID] = stats
		} else {
			// Endpoint exists but has never been called — return empty stats
			result[endpointUUID] = &EndpointStats{
				UUID:          endpointUUID,
				Path:          dataFromResult.Path,
				RecentSuccess: []ExecLog{},
				RecentFailed:  []ExecLog{},
			}
		}
	}

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
