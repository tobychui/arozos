package caldav

import (
	"strings"
	"testing"
	"time"
)

func TestReminderToICS_BasicFields(t *testing.T) {
	rm := ReminderItem{
		ID:       "rm_test1",
		Title:    "Buy milk",
		Notes:    "Two cartons",
		Priority: 3, // High
		DueDate:  "2024-03-15",
		DueTime:  "14:30",
		URL:      "https://example.com",
	}
	ics := reminderToICS(rm)

	checks := []string{
		"BEGIN:VCALENDAR",
		"BEGIN:VTODO",
		"UID:rm_test1@arozos",
		"SUMMARY:Buy milk",
		"DESCRIPTION:Two cartons",
		"DUE:20240315T143000",
		"PRIORITY:1", // High -> 1
		"STATUS:NEEDS-ACTION",
		"URL:https://example.com",
		"END:VTODO",
		"END:VCALENDAR",
	}
	for _, want := range checks {
		if !strings.Contains(ics, want) {
			t.Errorf("reminderToICS: missing %q in output:\n%s", want, ics)
		}
	}
}

func TestReminderToICS_AllDayDue(t *testing.T) {
	rm := ReminderItem{ID: "rm_ad", Title: "Pay rent", DueDate: "2024-04-01"}
	ics := reminderToICS(rm)
	if !strings.Contains(ics, "DUE;VALUE=DATE:20240401") {
		t.Errorf("expected date-only DUE, got:\n%s", ics)
	}
}

func TestReminderToICS_Completed(t *testing.T) {
	completedAt := time.Date(2024, 3, 16, 9, 0, 0, 0, time.UTC).UnixMilli()
	rm := ReminderItem{ID: "rm_done", Title: "Done", Completed: true, CompletedAt: completedAt}
	ics := reminderToICS(rm)
	for _, want := range []string{"STATUS:COMPLETED", "PERCENT-COMPLETE:100", "COMPLETED:20240316T090000Z"} {
		if !strings.Contains(ics, want) {
			t.Errorf("reminderToICS completed: missing %q in:\n%s", want, ics)
		}
	}
}

func TestReminderToICS_Recurring(t *testing.T) {
	rm := ReminderItem{ID: "rm_rec", Title: "Standup", DueDate: "2024-03-15", RRule: "FREQ=WEEKLY"}
	ics := reminderToICS(rm)
	if !strings.Contains(ics, "RRULE:FREQ=WEEKLY") {
		t.Errorf("expected RRULE in recurring reminder, got:\n%s", ics)
	}
}

func TestICSToReminder_RoundTrip(t *testing.T) {
	original := ReminderItem{
		ID:       "rm_rt",
		Title:    "Round trip",
		Notes:    "some notes",
		Priority: 2, // Medium
		DueDate:  "2024-06-01",
		DueTime:  "08:15",
		URL:      "https://example.org",
		RRule:    "FREQ=DAILY;INTERVAL=2",
	}
	ics := reminderToICS(original)
	parsed, err := icsToReminder(ics, "rm_rt")
	if err != nil {
		t.Fatalf("icsToReminder error: %v", err)
	}
	if parsed.Title != original.Title {
		t.Errorf("Title: got %q want %q", parsed.Title, original.Title)
	}
	if parsed.Notes != original.Notes {
		t.Errorf("Notes: got %q want %q", parsed.Notes, original.Notes)
	}
	if parsed.Priority != original.Priority {
		t.Errorf("Priority: got %d want %d", parsed.Priority, original.Priority)
	}
	if parsed.DueDate != original.DueDate {
		t.Errorf("DueDate: got %q want %q", parsed.DueDate, original.DueDate)
	}
	if parsed.DueTime != original.DueTime {
		t.Errorf("DueTime: got %q want %q", parsed.DueTime, original.DueTime)
	}
	if parsed.URL != original.URL {
		t.Errorf("URL: got %q want %q", parsed.URL, original.URL)
	}
	if parsed.RRule != original.RRule {
		t.Errorf("RRule: got %q want %q", parsed.RRule, original.RRule)
	}
}

func TestICSToReminder_iOSCompleted(t *testing.T) {
	ics := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\n" +
		"UID:ios-task@icloud.com\r\n" +
		"SUMMARY:Finish report\r\n" +
		"STATUS:COMPLETED\r\n" +
		"PERCENT-COMPLETE:100\r\n" +
		"COMPLETED:20240320T120000Z\r\n" +
		"END:VTODO\r\nEND:VCALENDAR\r\n"
	rm, err := icsToReminder(ics, "rm_url")
	if err != nil {
		t.Fatalf("icsToReminder error: %v", err)
	}
	if !rm.Completed {
		t.Error("expected reminder to be completed")
	}
	if rm.CompletedAt == 0 {
		t.Error("expected CompletedAt to be set")
	}
	if rm.Title != "Finish report" {
		t.Errorf("Title: got %q", rm.Title)
	}
}

func TestParseICSDue(t *testing.T) {
	cases := []struct {
		key, val    string
		wantDate    string
		wantTime    string
		description string
	}{
		{"DUE", "20240315T143000", "2024-03-15", "14:30", "floating datetime"},
		{"DUE", "20240315T143000Z", "2024-03-15", "14:30", "utc datetime treated as wall-clock"},
		{"DUE;VALUE=DATE", "20240401", "2024-04-01", "", "all-day"},
	}
	for _, tc := range cases {
		d, tm := parseICSDue(tc.key, tc.val)
		if d != tc.wantDate || tm != tc.wantTime {
			t.Errorf("parseICSDue(%s) [%s]: got (%q,%q) want (%q,%q)", tc.val, tc.description, d, tm, tc.wantDate, tc.wantTime)
		}
	}
}

func TestPriorityMapping(t *testing.T) {
	// ArozOS -> ICS -> ArozOS should be stable for the four canonical levels.
	for _, p := range []int{0, 1, 2, 3} {
		ics := arozPriorityToICS(p)
		back := icsPriorityToAroz(ics)
		if back != p {
			t.Errorf("priority round trip: %d -> ICS %d -> %d", p, ics, back)
		}
	}
	// Spot-check the iOS-facing values.
	if arozPriorityToICS(3) != 1 {
		t.Errorf("High should map to ICS PRIORITY 1, got %d", arozPriorityToICS(3))
	}
	if icsPriorityToAroz(5) != 2 {
		t.Errorf("ICS PRIORITY 5 should map to Medium, got %d", icsPriorityToAroz(5))
	}
}

func TestRemindersCTag_ChangesWithData(t *testing.T) {
	a := []ReminderItem{{ID: "a", Title: "A"}}
	b := []ReminderItem{{ID: "a", Title: "A"}, {ID: "b", Title: "B"}}
	if remindersCTag(a) == remindersCTag(b) {
		t.Error("remindersCTag should differ when reminders differ")
	}
}

func TestParseResourcePath(t *testing.T) {
	cases := []struct {
		path     string
		wantColl string
		wantID   string
	}{
		{"/alice/calendar/ev1.ics", "calendar", "ev1"},
		{"/alice/reminders/rm1.ics", "reminders", "rm1"},
		{"/alice/reminders/", "", ""},
		{"/alice/", "", ""},
		{"/alice/unknown/x.ics", "", ""},
	}
	for _, tc := range cases {
		coll, id := parseResourcePath(tc.path)
		if coll != tc.wantColl || id != tc.wantID {
			t.Errorf("parseResourcePath(%q): got (%q,%q) want (%q,%q)", tc.path, coll, id, tc.wantColl, tc.wantID)
		}
	}
}

func TestNormalizeRRule(t *testing.T) {
	cases := []struct{ in, want string }{
		{"FREQ=DAILY", "FREQ=DAILY"},
		{"RRULE:FREQ=WEEKLY", "FREQ=WEEKLY"},
		{"  FREQ=MONTHLY\r\n", "FREQ=MONTHLY"},
		{"", ""},
	}
	for _, tc := range cases {
		if got := normalizeRRule(tc.in); got != tc.want {
			t.Errorf("normalizeRRule(%q): got %q want %q", tc.in, got, tc.want)
		}
	}
}

func TestEventToICS_Recurring(t *testing.T) {
	ev := CalendarEvent{
		ID:    "ev_rec",
		Title: "Weekly sync",
		Start: time.Date(2024, 3, 15, 10, 0, 0, 0, time.UTC).UnixMilli(),
		End:   time.Date(2024, 3, 15, 11, 0, 0, 0, time.UTC).UnixMilli(),
		RRule: "FREQ=WEEKLY;BYDAY=MO",
	}
	ics := eventToICS(ev)
	if !strings.Contains(ics, "RRULE:FREQ=WEEKLY;BYDAY=MO") {
		t.Errorf("expected RRULE in recurring event, got:\n%s", ics)
	}
	parsed, err := icsToEvent(ics, "ev_rec")
	if err != nil {
		t.Fatalf("icsToEvent error: %v", err)
	}
	if parsed.RRule != "FREQ=WEEKLY;BYDAY=MO" {
		t.Errorf("event RRule round trip: got %q", parsed.RRule)
	}
}
