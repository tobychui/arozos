package caldav

/*
	caldav.go - CalDAV server for ArozOS Calendar and Reminders

	Implements a subset of RFC 4791 (CalDAV) sufficient for bidirectional
	sync with iOS Calendar and iOS Reminders.  Two calendar collections are
	exposed under one principal:

	  - "calendar"  : VEVENT components, backed by the Calendar web-app file
	                  (user:/Document/Calendar/events.json)
	  - "reminders" : VTODO components, backed by the Reminders web-app file
	                  (user:/Document/Reminders/data.json)

	Both share the same data files used by their web-apps, so the desktop
	and iOS stay in sync without any migration.  Recurring events and
	reminders are supported by passing RRULE through in both directions.

	Authentication: HTTP Basic Auth where
	  username = ArozOS username
	  password = an ArozOS auto-login token for that user

	URL layout:
	  /caldav/                                   service root (principal discovery)
	  /caldav/{username}/                        user principal & calendar home
	  /caldav/{username}/calendar/               event collection (VEVENT)
	  /caldav/{username}/calendar/{id}.ics       individual event resource
	  /caldav/{username}/reminders/              reminder collection (VTODO)
	  /caldav/{username}/reminders/{id}.ics      individual reminder resource
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
	RRule    string         `json:"rrule,omitempty"` // RFC 5545 recurrence rule, e.g. "FREQ=WEEKLY"
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
	username, ok := h.authenticate(r)
	if !ok {
		w.Header().Set("WWW-Authenticate", `Basic realm="ArozOS CalDAV"`)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, h.prefix)
	if path == "" {
		path = "/"
	}

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
		w.Header().Set("Allow", "OPTIONS, PROPFIND, REPORT, GET, HEAD, PUT, DELETE")
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	}
}

// authenticate validates HTTP Basic Auth credentials: username must match the
// owner of the supplied auto-login token.
func (h *Handler) authenticate(r *http.Request) (string, bool) {
	username, password, ok := r.BasicAuth()
	if !ok || password == "" {
		return "", false
	}
	valid, tokenOwner := h.authAgent.ValidateAutoLoginToken(password)
	if !valid || tokenOwner != username {
		return "", false
	}
	return username, true
}

// ── OPTIONS ──────────────────────────────────────────────────────────────────

func (h *Handler) handleOptions(w http.ResponseWriter) {
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

	// Consume the body (required even if unused, so the connection stays clean).
	io.ReadAll(r.Body) //nolint

	switch {
	case len(parts) == 0:
		h.propfindRoot(w, username)
	case len(parts) == 1:
		if parts[0] != username {
			http.Error(w, "Not Found", http.StatusNotFound)
			return
		}
		h.propfindPrincipal(w, username, depth)
	case len(parts) == 2 && parts[1] == "calendar":
		h.propfindCalendar(w, username, depth)
	case len(parts) == 2 && parts[1] == "reminders":
		h.propfindReminders(w, username, depth)
	default:
		http.Error(w, "Not Found", http.StatusNotFound)
	}
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

// propfindPrincipal answers PROPFIND on /caldav/{username}/.  This URL doubles
// as both the user principal and the calendar-home-set; a Depth:1 request
// enumerates the child calendar collections (events + reminders) so iOS can
// discover both the Calendar and Reminders services from a single account.
func (h *Handler) propfindPrincipal(w http.ResponseWriter, username string, depth string) {
	principalHref := h.prefix + "/" + username + "/"

	var sb strings.Builder
	sb.WriteString(xmlHeader())
	sb.WriteString(`<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">` + "\n")
	sb.WriteString(`  <D:response>` + "\n")
	sb.WriteString(`    <D:href>` + principalHref + `</D:href>` + "\n")
	sb.WriteString(`    <D:propstat>` + "\n")
	sb.WriteString(`      <D:prop>` + "\n")
	sb.WriteString(`        <D:resourcetype><D:collection/><D:principal/></D:resourcetype>` + "\n")
	sb.WriteString(`        <D:displayname>` + xmlEsc(username) + `</D:displayname>` + "\n")
	sb.WriteString(`        <D:current-user-principal><D:href>` + principalHref + `</D:href></D:current-user-principal>` + "\n")
	sb.WriteString(`        <D:principal-URL><D:href>` + principalHref + `</D:href></D:principal-URL>` + "\n")
	sb.WriteString(`        <C:calendar-home-set><D:href>` + principalHref + `</D:href></C:calendar-home-set>` + "\n")
	sb.WriteString(`      </D:prop>` + "\n")
	sb.WriteString(`      <D:status>HTTP/1.1 200 OK</D:status>` + "\n")
	sb.WriteString(`    </D:propstat>` + "\n")
	sb.WriteString(`  </D:response>` + "\n")

	if depth != "0" {
		// Enumerate the two calendar collections so clients see both.
		if events, err := h.loadEvents(username); err == nil {
			sb.WriteString(calendarCollectionResponse(
				h.prefix+"/"+username+"/calendar/", "ArozOS Calendar", "VEVENT", collectionCTag(events)))
		}
		if reminders, err := h.loadReminders(username); err == nil {
			sb.WriteString(calendarCollectionResponse(
				h.prefix+"/"+username+"/reminders/", "ArozOS Reminders", "VTODO", remindersCTag(reminders)))
		}
	}

	sb.WriteString(`</D:multistatus>`)
	writeXML(w, sb.String())
}

func (h *Handler) propfindCalendar(w http.ResponseWriter, username string, depth string) {
	events, err := h.loadEvents(username)
	if err != nil {
		logger.PrintAndLog("CalDAV", "load events for "+username, err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	calHref := h.prefix + "/" + username + "/calendar/"

	var sb strings.Builder
	sb.WriteString(xmlHeader())
	sb.WriteString(`<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">` + "\n")
	sb.WriteString(calendarCollectionResponse(calHref, "ArozOS Calendar", "VEVENT", collectionCTag(events)))

	if depth != "0" {
		for _, ev := range events {
			sb.WriteString(eventPropfindResponse(calHref+ev.ID+".ics", eventETag(ev)))
		}
	}

	sb.WriteString(`</D:multistatus>`)
	writeXML(w, sb.String())
}

// propfindReminders answers PROPFIND on the VTODO (reminders) collection.
func (h *Handler) propfindReminders(w http.ResponseWriter, username string, depth string) {
	reminders, err := h.loadReminders(username)
	if err != nil {
		logger.PrintAndLog("CalDAV", "load reminders for "+username, err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	remHref := h.prefix + "/" + username + "/reminders/"

	var sb strings.Builder
	sb.WriteString(xmlHeader())
	sb.WriteString(`<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">` + "\n")
	sb.WriteString(calendarCollectionResponse(remHref, "ArozOS Reminders", "VTODO", remindersCTag(reminders)))

	if depth != "0" {
		for _, rm := range reminders {
			sb.WriteString(eventPropfindResponse(remHref+rm.ID+".ics", reminderETag(rm)))
		}
	}

	sb.WriteString(`</D:multistatus>`)
	writeXML(w, sb.String())
}

// calendarCollectionResponse renders the <D:response> for a calendar collection
// advertising the given supported component (VEVENT or VTODO).
func calendarCollectionResponse(href, displayName, compName, ctag string) string {
	return `  <D:response>` + "\n" +
		`    <D:href>` + href + `</D:href>` + "\n" +
		`    <D:propstat>` + "\n" +
		`      <D:prop>` + "\n" +
		`        <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>` + "\n" +
		`        <D:displayname>` + xmlEsc(displayName) + `</D:displayname>` + "\n" +
		`        <C:supported-calendar-component-set><C:comp name="` + compName + `"/></C:supported-calendar-component-set>` + "\n" +
		`        <CS:getctag>` + ctag + `</CS:getctag>` + "\n" +
		`      </D:prop>` + "\n" +
		`      <D:status>HTTP/1.1 200 OK</D:status>` + "\n" +
		`    </D:propstat>` + "\n" +
		`  </D:response>` + "\n"
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
	if len(parts) < 2 {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}
	collection := parts[1]
	if collection != "calendar" && collection != "reminders" {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	bodyStr := string(body)

	collHref := h.prefix + "/" + username + "/" + collection + "/"

	// For calendar-multiget, only return the requested hrefs.
	var filterIDs map[string]bool
	if strings.Contains(bodyStr, "calendar-multiget") {
		filterIDs = hrefsToIDSet(bodyStr, collHref)
	}

	// (id, etag, ics) tuples for the requested collection.
	type resource struct{ id, etag, ics string }
	var resources []resource

	if collection == "reminders" {
		reminders, err := h.loadReminders(username)
		if err != nil {
			logger.PrintAndLog("CalDAV", "load reminders for "+username, err)
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}
		for _, rm := range reminders {
			resources = append(resources, resource{rm.ID, reminderETag(rm), reminderToICS(rm)})
		}
	} else {
		events, err := h.loadEvents(username)
		if err != nil {
			logger.PrintAndLog("CalDAV", "load events for "+username, err)
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}
		for _, ev := range events {
			resources = append(resources, resource{ev.ID, eventETag(ev), eventToICS(ev)})
		}
	}

	var sb strings.Builder
	sb.WriteString(xmlHeader())
	sb.WriteString(`<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` + "\n")

	for _, res := range resources {
		if filterIDs != nil && !filterIDs[res.id] {
			continue
		}
		sb.WriteString(`  <D:response>` + "\n")
		sb.WriteString(`    <D:href>` + collHref + res.id + `.ics</D:href>` + "\n")
		sb.WriteString(`    <D:propstat>` + "\n")
		sb.WriteString(`      <D:prop>` + "\n")
		sb.WriteString(`        <D:getetag>` + res.etag + `</D:getetag>` + "\n")
		sb.WriteString(`        <C:calendar-data>` + xmlEsc(res.ics) + `</C:calendar-data>` + "\n")
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
	collection, eventID := parseResourcePath(path)
	if eventID == "" {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}
	if collection == "reminders" {
		h.handleGetReminder(w, r, eventID, username)
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
	collection, eventID := parseResourcePath(path)
	if eventID == "" {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	if collection == "reminders" {
		h.handlePutReminder(w, string(body), eventID, username)
		return
	}

	newEv, err := icsToEvent(string(body), eventID)
	if err != nil || newEv.Title == "" {
		logger.PrintAndLog("CalDAV", "PUT: ICS parse failed for "+eventID, err)
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
	collection, eventID := parseResourcePath(path)
	if eventID == "" {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	if collection == "reminders" {
		h.handleDeleteReminder(w, eventID, username)
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
		return "", err
	}
	fsh, err := userObj.GetHomeFileSystemHandler()
	if err != nil {
		return "", err
	}
	return fsh.FileSystemAbstraction.VirtualPathToRealPath("/Document/Calendar/events.json", username)
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
	collection, id := parseResourcePath(path)
	if collection != "calendar" {
		return ""
	}
	return id
}

// parseResourcePath splits a resource URL such as /{username}/{collection}/{id}.ics
// into its collection ("calendar" or "reminders") and resource ID.  Both are
// returned empty when the path does not address a known resource.
func parseResourcePath(path string) (collection string, id string) {
	parts := splitURLPath(path)
	if len(parts) != 3 {
		return "", ""
	}
	if parts[1] != "calendar" && parts[1] != "reminders" {
		return "", ""
	}
	return parts[1], strings.TrimSuffix(parts[2], ".ics")
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
