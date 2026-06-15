package caldav

/*
	todo.go - VTODO (reminders) support for the CalDAV server

	Exposes the ArozOS Reminders web-app data (user:/Document/Reminders/data.json)
	as a CalDAV calendar collection of VTODO components so iOS Reminders can sync
	bidirectionally.  Recurring reminders are supported by passing RRULE through
	in both directions.

	The data file is shared with the Reminders web-app and has the shape
	{ "lists": [...], "reminders": [...] }; only the reminders array is touched
	by CalDAV writes, and unknown list data is preserved untouched.
*/

import (
	"crypto/md5"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

// ReminderItem mirrors a single reminder object in the Reminders data.json.
type ReminderItem struct {
	ID          string `json:"id"`
	ListID      string `json:"listId"`
	ParentID    string `json:"parentId,omitempty"`
	Title       string `json:"title"`
	Notes       string `json:"notes,omitempty"`
	Completed   bool   `json:"completed"`
	CompletedAt int64  `json:"completedAt,omitempty"`
	Flagged     bool   `json:"flagged,omitempty"`
	Priority    int    `json:"priority"`          // 0=None 1=Low 2=Medium 3=High
	DueDate     string `json:"dueDate,omitempty"` // YYYY-MM-DD
	DueTime     string `json:"dueTime,omitempty"` // HH:MM
	URL         string `json:"url,omitempty"`
	CreatedAt   int64  `json:"createdAt,omitempty"`
	Order       int64  `json:"order,omitempty"`
	RRule       string `json:"rrule,omitempty"` // RFC 5545 recurrence rule, e.g. "FREQ=DAILY"
}

// reminderList mirrors a list object; kept opaque so it round-trips untouched.
type reminderList struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color,omitempty"`
	Icon  string `json:"icon,omitempty"`
	Order int64  `json:"order,omitempty"`
}

// reminderStore is the on-disk shape of data.json.
type reminderStore struct {
	Lists     []reminderList `json:"lists"`
	Reminders []ReminderItem `json:"reminders"`
}

// ── Storage helpers ───────────────────────────────────────────────────────────

func (h *Handler) remindersFilePath(username string) (string, error) {
	userObj, err := h.userHandler.GetUserInfoFromUsername(username)
	if err != nil {
		return "", err
	}
	fsh, err := userObj.GetHomeFileSystemHandler()
	if err != nil {
		return "", err
	}
	return fsh.FileSystemAbstraction.VirtualPathToRealPath("/Document/Reminders/data.json", username)
}

func (h *Handler) loadReminderStore(username string) (reminderStore, error) {
	store := reminderStore{Lists: []reminderList{}, Reminders: []ReminderItem{}}
	p, err := h.remindersFilePath(username)
	if err != nil {
		return store, err
	}
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return store, nil
		}
		return store, err
	}
	if err := json.Unmarshal(data, &store); err != nil {
		return store, err
	}
	return store, nil
}

func (h *Handler) loadReminders(username string) ([]ReminderItem, error) {
	store, err := h.loadReminderStore(username)
	if err != nil {
		return nil, err
	}
	return store.Reminders, nil
}

func (h *Handler) saveReminderStore(username string, store reminderStore) error {
	p, err := h.remindersFilePath(username)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		return err
	}
	if store.Lists == nil {
		store.Lists = []reminderList{}
	}
	if store.Reminders == nil {
		store.Reminders = []ReminderItem{}
	}
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0644)
}

// defaultListID returns the list a CalDAV-created reminder should belong to:
// the first existing list, or "ls_default" to match the web-app's seed list.
func defaultListID(store reminderStore) string {
	if len(store.Lists) > 0 {
		return store.Lists[0].ID
	}
	return "ls_default"
}

// ── HTTP handlers (called from caldav.go dispatch) ─────────────────────────────

func (h *Handler) handleGetReminder(w http.ResponseWriter, r *http.Request, id string, username string) {
	reminders, err := h.loadReminders(username)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	for _, rm := range reminders {
		if rm.ID == id {
			ics := reminderToICS(rm)
			w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
			w.Header().Set("ETag", reminderETag(rm))
			if r.Method == http.MethodHead {
				w.WriteHeader(http.StatusOK)
				return
			}
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, ics)
			return
		}
	}
	http.Error(w, "Not Found", http.StatusNotFound)
}

func (h *Handler) handlePutReminder(w http.ResponseWriter, body string, id string, username string) {
	newRm, err := icsToReminder(body, id)
	if err != nil || newRm.Title == "" {
		logger.PrintAndLog("CalDAV", "PUT: VTODO parse failed for "+id, err)
		http.Error(w, "Bad Request: cannot parse VTODO", http.StatusBadRequest)
		return
	}
	newRm.ID = id

	h.mu.Lock()
	defer h.mu.Unlock()

	store, err := h.loadReminderStore(username)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	isUpdate := false
	for i, rm := range store.Reminders {
		if rm.ID == id {
			// Preserve fields that VTODO does not carry (list membership,
			// hierarchy, creation/order metadata) across the update.
			newRm.ListID = rm.ListID
			newRm.ParentID = rm.ParentID
			newRm.CreatedAt = rm.CreatedAt
			newRm.Order = rm.Order
			store.Reminders[i] = newRm
			isUpdate = true
			break
		}
	}
	if !isUpdate {
		newRm.ListID = defaultListID(store)
		newRm.CreatedAt = time.Now().UnixMilli()
		newRm.Order = newRm.CreatedAt
		store.Reminders = append(store.Reminders, newRm)
	}

	if err := h.saveReminderStore(username, store); err != nil {
		logger.PrintAndLog("CalDAV", "save reminders for "+username, err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("ETag", reminderETag(newRm))
	if isUpdate {
		w.WriteHeader(http.StatusNoContent)
	} else {
		w.WriteHeader(http.StatusCreated)
	}
}

func (h *Handler) handleDeleteReminder(w http.ResponseWriter, id string, username string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	store, err := h.loadReminderStore(username)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	kept := make([]ReminderItem, 0, len(store.Reminders))
	found := false
	for _, rm := range store.Reminders {
		// Deleting a reminder also removes its sub-tasks, mirroring the web-app.
		if rm.ID == id {
			found = true
			continue
		}
		if rm.ParentID == id {
			continue
		}
		kept = append(kept, rm)
	}
	if !found {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}
	store.Reminders = kept

	if err := h.saveReminderStore(username, store); err != nil {
		logger.PrintAndLog("CalDAV", "save reminders for "+username, err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── VTODO conversion ───────────────────────────────────────────────────────────

// reminderToICS serialises a ReminderItem as a VCALENDAR / VTODO string.
func reminderToICS(rm ReminderItem) string {
	var sb strings.Builder
	sb.WriteString("BEGIN:VCALENDAR\r\n")
	sb.WriteString("VERSION:2.0\r\n")
	sb.WriteString("PRODID:-//ArozOS//CalDAV//EN\r\n")
	sb.WriteString("BEGIN:VTODO\r\n")
	sb.WriteString("UID:" + rm.ID + "@arozos\r\n")
	sb.WriteString("SUMMARY:" + escapeICSText(rm.Title) + "\r\n")

	if rm.Notes != "" {
		sb.WriteString("DESCRIPTION:" + escapeICSText(rm.Notes) + "\r\n")
	}
	if rm.DueDate != "" {
		sb.WriteString(reminderDueToICS(rm.DueDate, rm.DueTime) + "\r\n")
	}
	if prio := arozPriorityToICS(rm.Priority); prio > 0 {
		sb.WriteString("PRIORITY:" + strconv.Itoa(prio) + "\r\n")
	}
	if rm.Completed {
		sb.WriteString("STATUS:COMPLETED\r\n")
		sb.WriteString("PERCENT-COMPLETE:100\r\n")
		if rm.CompletedAt > 0 {
			sb.WriteString("COMPLETED:" + time.UnixMilli(rm.CompletedAt).UTC().Format("20060102T150405Z") + "\r\n")
		}
	} else {
		sb.WriteString("STATUS:NEEDS-ACTION\r\n")
	}
	if rm.URL != "" {
		sb.WriteString("URL:" + escapeICSText(rm.URL) + "\r\n")
	}
	if rm.ParentID != "" {
		sb.WriteString("RELATED-TO:" + rm.ParentID + "@arozos\r\n")
	}
	if rrule := normalizeRRule(rm.RRule); rrule != "" {
		sb.WriteString("RRULE:" + rrule + "\r\n")
	}

	sb.WriteString("END:VTODO\r\n")
	sb.WriteString("END:VCALENDAR\r\n")
	return sb.String()
}

// icsToReminder parses a VCALENDAR string containing a VTODO into a ReminderItem.
// idHint is used as the reminder ID when the UID is absent or needs normalising.
func icsToReminder(icsData string, idHint string) (ReminderItem, error) {
	lines := unfoldICSLines(icsData)

	rm := ReminderItem{ID: idHint}
	inVTodo := false

	for _, line := range lines {
		switch strings.ToUpper(line) {
		case "BEGIN:VTODO":
			inVTodo = true
			continue
		case "END:VTODO":
			inVTodo = false
			continue
		}
		if !inVTodo {
			continue
		}

		key, val := splitICSLine(line)
		baseKey := strings.ToUpper(strings.Split(key, ";")[0])

		switch baseKey {
		case "UID":
			uid := unescapeICSText(strings.TrimSpace(val))
			uid = strings.TrimSuffix(uid, "@arozos")
			if uid != "" {
				rm.ID = uid
			}
		case "SUMMARY":
			rm.Title = unescapeICSText(val)
		case "DESCRIPTION":
			rm.Notes = unescapeICSText(val)
		case "DUE":
			rm.DueDate, rm.DueTime = parseICSDue(key, val)
		case "PRIORITY":
			if v, err := strconv.Atoi(strings.TrimSpace(val)); err == nil {
				rm.Priority = icsPriorityToAroz(v)
			}
		case "STATUS":
			rm.Completed = strings.EqualFold(strings.TrimSpace(val), "COMPLETED")
		case "COMPLETED":
			if t, _ := parseICSDateTime(key, val); !t.IsZero() {
				rm.CompletedAt = t.UnixMilli()
			}
		case "PERCENT-COMPLETE":
			if v, err := strconv.Atoi(strings.TrimSpace(val)); err == nil && v >= 100 {
				rm.Completed = true
			}
		case "URL":
			rm.URL = unescapeICSText(val)
		case "RELATED-TO":
			rm.ParentID = strings.TrimSuffix(unescapeICSText(strings.TrimSpace(val)), "@arozos")
		case "RRULE":
			rm.RRule = normalizeRRule(strings.TrimSpace(val))
		}
	}

	if rm.Completed && rm.CompletedAt == 0 {
		rm.CompletedAt = time.Now().UnixMilli()
	}

	return rm, nil
}

// reminderDueToICS formats a reminder due date/time as a DUE property value.
// Reminders use floating local time (no timezone) so the literal wall-clock
// time set on the desktop matches what iOS shows and vice-versa.
func reminderDueToICS(dueDate, dueTime string) string {
	d := strings.ReplaceAll(dueDate, "-", "")
	if dueTime == "" {
		return "DUE;VALUE=DATE:" + d
	}
	t := strings.ReplaceAll(dueTime, ":", "")
	return "DUE:" + d + "T" + t + "00"
}

// parseICSDue extracts a reminder's date (YYYY-MM-DD) and time (HH:MM) from a
// DUE property, treating the value as floating local time.  An all-day DUE
// (VALUE=DATE) yields an empty time.
func parseICSDue(key, val string) (dueDate, dueTime string) {
	val = strings.TrimSpace(val)
	val = strings.TrimSuffix(val, "Z") // ignore UTC designator; treat as wall-clock
	if len(val) >= 8 {
		dueDate = val[:4] + "-" + val[4:6] + "-" + val[6:8]
	}
	if strings.Contains(strings.ToUpper(key), "VALUE=DATE") {
		return dueDate, ""
	}
	if idx := strings.Index(val, "T"); idx >= 0 {
		t := val[idx+1:]
		if len(t) >= 4 {
			dueTime = t[:2] + ":" + t[2:4]
		}
	}
	return dueDate, dueTime
}

// arozPriorityToICS maps the ArozOS priority (0..3) to an iCalendar PRIORITY
// (1=high .. 9=low, 0=undefined) using the values iOS understands.
func arozPriorityToICS(p int) int {
	switch p {
	case 3: // High
		return 1
	case 2: // Medium
		return 5
	case 1: // Low
		return 9
	default: // None
		return 0
	}
}

// icsPriorityToAroz maps an iCalendar PRIORITY back to the ArozOS scale.
func icsPriorityToAroz(p int) int {
	switch {
	case p <= 0:
		return 0 // None / undefined
	case p <= 4:
		return 3 // High
	case p == 5:
		return 2 // Medium
	default:
		return 1 // Low (6..9)
	}
}

// reminderETag returns a quoted MD5 ETag for the given reminder.
func reminderETag(rm ReminderItem) string {
	data, _ := json.Marshal(rm)
	h := md5.Sum(data)
	return fmt.Sprintf(`"%x"`, h)
}

// remindersCTag returns an unquoted MD5 sync token for the whole collection.
func remindersCTag(reminders []ReminderItem) string {
	data, _ := json.Marshal(reminders)
	h := md5.Sum(data)
	return fmt.Sprintf("%x", h)
}
