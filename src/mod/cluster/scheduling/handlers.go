package scheduling

/*
	Scheduling admin endpoints (/system/cluster/sched/*, admin only).
*/

import (
	"encoding/json"
	"net/http"
	"strconv"

	"imuslab.com/arozos/mod/utils"
)

func sendJSON(w http.ResponseWriter, v interface{}) {
	js, _ := json.Marshal(v)
	utils.SendJSONResponse(w, string(js))
}

// HandleStatus returns the weights and a per-node score preview.
func (s *Manager) HandleStatus(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, s.Status())
}

// HandleWeights reads (GET) or updates (POST) the weights. POST accepts any
// subset of the fields; missing ones keep their current value.
func (s *Manager) HandleWeights(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendJSON(w, s.Weights())
		return
	}
	if reset, _ := utils.PostBool(r, "reset"); reset {
		if err := s.ResetWeights(); err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		sendJSON(w, s.Weights())
		return
	}
	cur := s.Weights()
	fields := map[string]*float64{
		"locality": &cur.Locality, "cpu": &cur.CPU, "memory": &cur.Memory, "disk": &cur.Disk,
		"queue": &cur.Queue, "latency": &cur.Latency, "degraded": &cur.Degraded, "preferred": &cur.Preferred,
	}
	for name, target := range fields {
		if raw := r.PostFormValue(name); raw != "" {
			v, err := strconv.ParseFloat(raw, 64)
			if err != nil {
				utils.SendErrorResponse(w, "weight "+name+" must be a number")
				return
			}
			*target = v
		}
	}
	if err := s.SetWeights(cur); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	sendJSON(w, s.Weights())
}

// Explainer is supplied by the core: it scores the candidates of one job (or
// of a hypothetical job) and returns the ranking.
type Explainer func(r *http.Request) (interface{}, error)

// RegisterAdminRoutes mounts the handlers. explain answers
// /system/cluster/sched/explain and is provided by the core because it needs
// the job records.
func (s *Manager) RegisterAdminRoutes(register func(pattern string, handler func(http.ResponseWriter, *http.Request)), explain Explainer) {
	register("/system/cluster/sched/status", s.HandleStatus)
	register("/system/cluster/sched/weights", s.HandleWeights)
	if explain != nil {
		register("/system/cluster/sched/explain", func(w http.ResponseWriter, r *http.Request) {
			out, err := explain(r)
			if err != nil {
				utils.SendErrorResponse(w, err.Error())
				return
			}
			sendJSON(w, out)
		})
	}
}
