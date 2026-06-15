package caldav

/*
	caldav.go - CalDAV server for ArozOS Calendar

	Implements a subset of RFC 4791 (CalDAV) sufficient for bidirectional
	sync with iOS Calendar.  Events are stored in the same JSON file used
	by the Calendar web-app (user:/Document/Calendar/events.json) so both
	interfaces share the same data without any migration.

	Authentication: HTTP Basic Auth where
	  username = ArozOS username
	  password = an ArozOS auto-login token for that user

	URL layout:
	  /caldav/                                  service root (principal discovery)
	  /caldav/{username}/                       user principal
	  /caldav/{username}/calendar/              calendar collection
	  /caldav/{username}/calendar/{id}.ics      individual event resource
*/

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"imuslab.com/arozos/mod/auth"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/user"
)

// CalendarEvent mirrors the JSON schema used by the Calendar web-app.
type CalendarEvent struct {
	ID       string         `json:"id"`
	Title    string         `json:"title"`
	AllDay   bool           `json:"allDay"`
	Start    int64          `json:"start"` // Unix milliseconds
	End      int64          `json:"end"`   // Unix milliseconds
	Address  string         `json:"address,omitempty"`
	Notes    string         `json:"notes,omitempty"`
	Reminder *EventReminder `json:"reminder,omitempty"`
	Color    string         `json:"color,omitempty"`
}

// EventReminder matches the reminder sub-object in events.json.
type EventReminder struct {
	Value int    `json:"value"`
	Unit  string `json:"unit"` // "mins" | "hours" | "days"
}

// Handler is the CalDAV HTTP handler.
type Handler struct {
	authAgent   *auth.AuthAgent
	userHandler *user.UserHandler
	prefix      string
	mu          sync.Mutex // guards concurrent writes to events.json
}

// HandlerOptions holds the dependencies required to create a Handler.
type HandlerOptions struct {
	AuthAgent   *auth.AuthAgent
	UserHandler *user.UserHandler
	// Prefix is the HTTP path prefix, e.g. "/caldav".  Defaults to "/caldav".
	Prefix string
}

// NewHandler constructs a CalDAV Handler.
func NewHandler(opts HandlerOptions) *Handler {
	prefix := strings.TrimRight(opts.Prefix, "/")
	if prefix == "" {
		prefix = "/caldav"
	}
	return &Handler{
		authAgent:   opts.AuthAgent,
		userHandler: opts.UserHandler,
		prefix:      prefix,
	}
}

// ServeHTTP implements http.Handler.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	logger.PrintAndLog("CalDAV", r.Method+" "+r.URL.Path+" (UA: "+r.UserAgent()+")", nil)

	username, ok := h.authenticate(r)
	if !ok {
		logger.PrintAndLog("CalDAV", "Auth failed for "+r.Method+" "+r.URL.Path+
			" — no valid Basic Auth token (user="+basicAuthUser(r)+")", nil)
		w.Header().Set("WWW-Authenticate", `Basic realm="ArozOS CalDAV"`)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, h.prefix)
	if path == "" {
		path = "/"
	}

	logger.PrintAndLog("CalDAV", "Authenticated user="+username+" method="+r.Method+" path="+path, nil)

	switch r.Method {
	case http.MethodOptions:
		h.handleOptions(w)
	case "PROPFIND":
		h.handlePropfind(w, r, path, username)
	case "REPORT":
		h.handleReport(w, r, path, username)
	case http.MethodGet, http.MethodHead:
		h.handleGet(w, r, path, username)
	case http.MethodPut:
		h.handlePut(w, r, path, username)
	case http.MethodDelete:
		h.handleDelete(w, r, path, username)
	default:
		logger.PrintAndLog("CalDAV", "Method not allowed: "+r.Method, nil)
		w.Header().Set("Allow", "OPTIONS, PROPFIND, REPORT, GET, HEAD, PUT, DELETE")
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	}
}

// basicAuthUser extracts just the username from Basic Auth without validating.
func basicAuthUser(r *http.Request) string {
	u, _, ok := r.BasicAuth()
	if !ok {
		return "(no basic auth)"
	}
	return u
}

// authenticate validates HTTP Basic Auth credentials: username must match the
// owner of the supplied auto-login token.
func (h *Handler) authenticate(r *http.Request) (string, bool) {
	username, password, ok := r.BasicAuth()
	if !ok {
		logger.PrintAndLog("CalDAV", "authenticate: no Basic Auth header present", nil)
		return "", false
	}
	if password == "" {
		logger.PrintAndLog("CalDAV", "authenticate: empty password for user="+username, nil)
		return "", false
	}
	valid, tokenOwner := h.authAgent.ValidateAutoLoginToken(password)
	if !valid {
		logger.PrintAndLog("CalDAV", "authenticate: token invalid for user="+username+" (token len="+fmt.Sprintf("%d", len(password))+")", nil)
		return "", false
	}
	if tokenOwner != username {
		logger.PrintAndLog("CalDAV", "authenticate: token owner="+tokenOwner+" does not match claimed user="+username, nil)
		return "", false
	}
	return username, true
}

// ── OPTIONS ──────────────────────────────────────────────────────────────────

func (h *Handler) handleOptions(w http.ResponseWriter) {
	logger.PrintAndLog("CalDAV", "OPTIONS → advertising DAV: 1, 2, calendar-access", nil)
	w.Header().Set("DAV", "1, 2, calendar-access")
	w.Header().Set("Allow", "OPTIONS, PROPFIND, REPORT, GET, HEAD, PUT, DELETE")
	w.WriteHeader(http.StatusOK)
}

// ── PROPFIND ─────────────────────────────────────────────────────────────────

func (h *Handler) handlePropfind(w http.ResponseWriter, r *http.Request, path string, username string) {
	depth := r.Header.Get("Depth")
	if depth == "" {
		depth = "0"
	}
	parts := splitURLPath(path)

	// Log the PROPFIND request body for debugging
	body, _ := io.ReadAll(r.Body)
	logger.PrintAndLog("CalDAV", fmt.Sprintf("PROPFIND depth=%s path=%s parts=%v body=%s", depth, path, parts, truncate(string(body), 512)), nil)

	switch {
	case len(parts) == 0:
		logger.PrintAndLog("CalDAV", "PROPFIND → service root (current-user-principal)", nil)
		h.propfindRoot(w, username)
	case len(parts) == 1:
		if parts[0] != username {
			logger.PrintAndLog("CalDAV", "PROPFIND: path user="+parts[0]+" != authenticated user="+username, nil)
			http.Error(w, "Not Found", http.StatusNotFound)
			return
		}
		logger.PrintAndLog("CalDAV", "PROPFIND → user principal for "+username, nil)
		h.propfindPrincipal(w, username)
	case len(parts) == 2 && parts[1] == "calendar":
		logger.PrintAndLog("CalDAV", "PROPFIND → calendar collection depth="+depth+" for "+username, nil)
		h.propfindCalendar(w, r, username, depth)
	default:
		logger.PrintAndLog("CalDAV", "PROPFIND: unrecognised path parts="+fmt.Sprintf("%v", parts), nil)
		http.Error(w, "Not Found", http.StatusNotFound)
	}
}

// truncate shortens a string for log output.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func (h *Handler) propfindRoot(w http.ResponseWriter, username string) {
	principalHref := h.prefix + "/" + username + "/"
	body := xmlHeader() +
		`<D:multistatus xmlns:D="DAV:">` + "\n" +
		`  <D:response>` + "\n" +
		`    <D:href>` + h.prefix + `/</D:href>` + "\n" +
		`    <D:propstat>` + "\n" +
		`      <D:prop>` + "\n" +
		`        <D:current-user-principal><D:href>` + principalHref + `</D:href></D:current-user-principal>` + "\n" +
		`      </D:prop>` + "\n" +
		`      <D:status>HTTP/1.1 200 OK</D:status>` + "\n" +
		`    </D:propstat>` + "\n" +
		`  </D:response>` + "\n" +
		`</D:multistatus>`
	writeXML(w, body)
}

func (h *Handler) propfindPrincipal(w http.ResponseWriter, username string) {
	principalHref := h.prefix + "/" + username + "/"
	calHomeHref := h.prefix + "/" + username + "/calendar/"
	body := xmlHeader() +
		`<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` + "\n" +
		`  <D:response>` + "\n" +
		`    <D:href>` + principalHref + `</D:href>` + "\n" +
		`    <D:propstat>` + "\n" +
		`      <D:prop>` + "\n" +
		`        <D:displayname>` + xmlEsc(username) + `</D:displayname>` + "\n" +
		`        <D:principal-URL><D:href>` + principalHref + `</D:href></D:principal-URL>` + "\n" +
		`        <C:calendar-home-set><D:href>` + calHomeHref + `</D:href></C:calendar-home-set>` + "\n" +
		`      </D:prop>` + "\n" +
		`      <D:status>HTTP/1.1 200 OK</D:status>` + "\n" +
		`    </D:propstat>` + "\n" +
		`  </D:response>` + "\n" +
		`</D:multistatus>`
	writeXML(w, body)
}

func (h *Handler) propfindCalendar(w http.ResponseWriter, r *http.Request, username string, depth string) {
	events, err := h.loadEvents(username)
	if err != nil {
		logger.PrintAndLog("CalDAV", "load events for "+username, err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	calHref := h.prefix + "/" + username + "/calendar/"
	ctag := collectionCTag(events)

	var sb strings.Builder
	sb.WriteString(xmlHeader())
	sb.WriteString(`<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">` + "\n")
	sb.WriteString(`  <D:response>` + "\n")
	sb.WriteString(`    <D:href>` + calHref + `</D:href>` + "\n")
	sb.WriteString(`    <D:propstat>` + "\n")
	sb.WriteString(`      <D:prop>` + "\n")
	sb.WriteString(`        <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>` + "\n")
	sb.WriteString(`        <D:displayname>ArozOS Calendar</D:displayname>` + "\n")
	sb.WriteString(`        <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>` + "\n")
	sb.WriteString(`        <CS:getctag>` + ctag + `</CS:getctag>` + "\n")
	sb.WriteString(`      </D:prop>` + "\n")
	sb.WriteString(`      <D:status>HTTP/1.1 200 OK</D:status>` + "\n")
	sb.WriteString(`    </D:propstat>` + "\n")
	sb.WriteString(`  </D:response>` + "\n")

	if depth != "0" {
		for _, ev := range events {
			sb.WriteString(eventPropfindResponse(calHref+ev.ID+".ics", eventETag(ev)))
		}
	}

	sb.WriteString(`</D:multistatus>`)
	writeXML(w, sb.String())
}

func eventPropfindResponse(href, etag string) string {
	return `  <D:response>` + "\n" +
		`    <D:href>` + href + `</D:href>` + "\n" +
		`    <D:propstat>` + "\n" +
		`      <D:prop>` + "\n" +
		`        <D:getetag>` + etag + `</D:getetag>` + "\n" +
		`        <D:resourcetype/>` + "\n" +
		`        <D:getcontenttype>text/calendar; charset=utf-8</D:getcontenttype>` + "\n" +
		`      </D:prop>` + "\n" +
		`      <D:status>HTTP/1.1 200 OK</D:status>` + "\n" +
		`    </D:propstat>` + "\n" +
		`  </D:response>` + "\n"
}

// ── REPORT ───────────────────────────────────────────────────────────────────

func (h *Handler) handleReport(w http.ResponseWriter, r *http.Request, path string, username string) {
	parts := splitURLPath(path)
	if len(parts) < 2 || parts[1] != "calendar" {
		logger.PrintAndLog("CalDAV", "REPORT: bad path parts="+fmt.Sprintf("%v", parts), nil)
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	logger.PrintAndLog("CalDAV", "REPORT body="+truncate(string(body), 512), nil)

	events, err := h.loadEvents(username)
	if err != nil {
		logger.PrintAndLog("CalDAV", "load events for "+username, err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	logger.PrintAndLog("CalDAV", fmt.Sprintf("REPORT: serving %d events for %s", len(events), username), nil)

	calHref := h.prefix + "/" + username + "/calendar/"
	bodyStr := string(body)

	// For calendar-multiget, only return the requested hrefs.
	var filterIDs map[string]bool
	if strings.Contains(bodyStr, "calendar-multiget") {
		filterIDs = hrefsToIDSet(bodyStr, calHref)
	}

	var sb strings.Builder
	sb.WriteString(xmlHeader())
	sb.WriteString(`<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` + "\n")

	for _, ev := range events {
		if filterIDs != nil && !filterIDs[ev.ID] {
			continue
		}
		icsData := eventToICS(ev)
		sb.WriteString(`  <D:response>` + "\n")
		sb.WriteString(`    <D:href>` + calHref + ev.ID + `.ics</D:href>` + "\n")
		sb.WriteString(`    <D:propstat>` + "\n")
		sb.WriteString(`      <D:prop>` + "\n")
		sb.WriteString(`        <D:getetag>` + eventETag(ev) + `</D:getetag>` + "\n")
		sb.WriteString(`        <C:calendar-data>` + xmlEsc(icsData) + `</C:calendar-data>` + "\n")
		sb.WriteString(`      </D:prop>` + "\n")
		sb.WriteString(`      <D:status>HTTP/1.1 200 OK</D:status>` + "\n")
		sb.WriteString(`    </D:propstat>` + "\n")
		sb.WriteString(`  </D:response>` + "\n")
	}

	sb.WriteString(`</D:multistatus>`)
	writeXML(w, sb.String())
}

// ── GET / HEAD ────────────────────────────────────────────────────────────────

func (h *Handler) handleGet(w http.ResponseWriter, r *http.Request, path string, username string) {
	eventID := extractEventID(path)
	if eventID == "" {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}

	events, err := h.loadEvents(username)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	for _, ev := range events {
		if ev.ID == eventID {
			icsData := eventToICS(ev)
			w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
			w.Header().Set("ETag", eventETag(ev))
			if r.Method == http.MethodHead {
				w.WriteHeader(http.StatusOK)
				return
			}
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, icsData)
			return
		}
	}
	http.Error(w, "Not Found", http.StatusNotFound)
}

// ── PUT ───────────────────────────────────────────────────────────────────────

func (h *Handler) handlePut(w http.ResponseWriter, r *http.Request, path string, username string) {
	eventID := extractEventID(path)
	if eventID == "" {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	logger.PrintAndLog("CalDAV", "PUT eventID="+eventID+" body="+truncate(string(body), 512), nil)

	newEv, err := icsToEvent(string(body), eventID)
	if err != nil || newEv.Title == "" {
		logger.PrintAndLog("CalDAV", "PUT: ICS parse failed for eventID="+eventID+" err="+fmt.Sprintf("%v", err)+" title="+newEv.Title, nil)
		http.Error(w, "Bad Request: cannot parse ICS", http.StatusBadRequest)
		return
	}
	// Always use the URL path segment as the canonical ID.
	newEv.ID = eventID

	h.mu.Lock()
	defer h.mu.Unlock()

	events, err := h.loadEvents(username)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	isUpdate := false
	for i, ev := range events {
		if ev.ID == eventID {
			events[i] = newEv
			isUpdate = true
			break
		}
	}
	if !isUpdate {
		events = append(events, newEv)
	}

	if err := h.saveEvents(username, events); err != nil {
		logger.PrintAndLog("CalDAV", "save events for "+username, err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("ETag", eventETag(newEv))
	if isUpdate {
		w.WriteHeader(http.StatusNoContent)
	} else {
		w.WriteHeader(http.StatusCreated)
	}
}

// ── DELETE ────────────────────────────────────────────────────────────────────

func (h *Handler) handleDelete(w http.ResponseWriter, r *http.Request, path string, username string) {
	eventID := extractEventID(path)
	if eventID == "" {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	events, err := h.loadEvents(username)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	var kept []CalendarEvent
	found := false
	for _, ev := range events {
		if ev.ID == eventID {
			found = true
		} else {
			kept = append(kept, ev)
		}
	}
	if !found {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}

	if err := h.saveEvents(username, kept); err != nil {
		logger.PrintAndLog("CalDAV", "save events for "+username, err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Storage helpers ───────────────────────────────────────────────────────────

func (h *Handler) eventsFilePath(username string) (string, error) {
	userObj, err := h.userHandler.GetUserInfoFromUsername(username)
	if err != nil {
		logger.PrintAndLog("CalDAV", "eventsFilePath: GetUserInfoFromUsername failed for "+username, err)
		return "", err
	}
	fsh, err := userObj.GetHomeFileSystemHandler()
	if err != nil {
		logger.PrintAndLog("CalDAV", "eventsFilePath: GetHomeFileSystemHandler failed for "+username, err)
		return "", err
	}
	p, err := fsh.FileSystemAbstraction.VirtualPathToRealPath("/Document/Calendar/events.json", username)
	if err != nil {
		logger.PrintAndLog("CalDAV", "eventsFilePath: VirtualPathToRealPath failed for "+username, err)
		return "", err
	}
	logger.PrintAndLog("CalDAV", "eventsFilePath: resolved to "+p+" for "+username, nil)
	return p, nil
}

func (h *Handler) loadEvents(username string) ([]CalendarEvent, error) {
	p, err := h.eventsFilePath(username)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return []CalendarEvent{}, nil
		}
		return nil, err
	}
	var events []CalendarEvent
	if err := json.Unmarshal(data, &events); err != nil {
		return nil, err
	}
	return events, nil
}

func (h *Handler) saveEvents(username string, events []CalendarEvent) error {
	p, err := h.eventsFilePath(username)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		return err
	}
	if events == nil {
		events = []CalendarEvent{}
	}
	data, err := json.MarshalIndent(events, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0644)
}

// ── XML / path utilities ──────────────────────────────────────────────────────

func writeXML(w http.ResponseWriter, body string) {
	logger.PrintAndLog("CalDAV", "207 response body="+truncate(body, 1024), nil)
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.WriteHeader(207)
	fmt.Fprint(w, body)
}

func xmlHeader() string {
	return `<?xml version="1.0" encoding="UTF-8"?>` + "\n"
}

// xmlEsc escapes the five XML predefined entities.
func xmlEsc(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, `"`, "&quot;")
	s = strings.ReplaceAll(s, "'", "&apos;")
	return s
}

// splitURLPath trims slashes and splits a URL path into segments,
// returning an empty slice for the root.
func splitURLPath(path string) []string {
	path = strings.Trim(path, "/")
	if path == "" {
		return []string{}
	}
	return strings.Split(path, "/")
}

// extractEventID returns the event ID encoded in a path like
// /{username}/calendar/{id}.ics, or "" if the path is not an event URL.
func extractEventID(path string) string {
	parts := splitURLPath(path)
	if len(parts) != 3 || parts[1] != "calendar" {
		return ""
	}
	return strings.TrimSuffix(parts[2], ".ics")
}

// hrefsToIDSet parses href elements from a calendar-multiget body and
// returns the set of event IDs (filename without .ics).
// iOS URL-encodes special characters (e.g. %40 for @) and may include
// namespace attributes on the element, so we match by tag name suffix
// and URL-decode before comparing against calHref.
func hrefsToIDSet(body string, calHref string) map[string]bool {
	result := make(map[string]bool)
	for _, chunk := range strings.Split(body, "<") {
		// Skip closing tags
		if strings.HasPrefix(chunk, "/") {
			continue
		}
		// Determine the tag name (everything before the first space or ">")
		tagEnd := strings.IndexAny(chunk, " >")
		if tagEnd < 0 {
			continue
		}
		tagName := strings.ToLower(chunk[:tagEnd])
		// Match any *:href or bare "href" element
		if tagName != "href" && !strings.HasSuffix(tagName, ":href") {
			continue
		}
		// Content starts after the closing ">" of the opening tag
		gtIdx := strings.Index(chunk, ">")
		if gtIdx < 0 {
			continue
		}
		raw := strings.TrimSpace(strings.SplitN(chunk[gtIdx+1:], "<", 2)[0])
		// Decode percent-encoding (iOS sends %40 for @, etc.)
		decoded, err := url.PathUnescape(raw)
		if err != nil {
			decoded = raw
		}
		if !strings.HasSuffix(decoded, ".ics") {
			continue
		}
		id := strings.TrimSuffix(strings.TrimPrefix(decoded, calHref), ".ics")
		if id != "" && !strings.Contains(id, "/") {
			result[id] = true
		}
	}
	return result
}
