package caldav

import (
	"strings"
	"testing"
	"time"
)

func TestEventToICS_BasicFields(t *testing.T) {
	ev := CalendarEvent{
		ID:      "ev_test1",
		Title:   "Team Meeting",
		AllDay:  false,
		Start:   time.Date(2024, 3, 15, 10, 0, 0, 0, time.UTC).UnixMilli(),
		End:     time.Date(2024, 3, 15, 11, 0, 0, 0, time.UTC).UnixMilli(),
		Address: "Conference Room",
		Notes:   "Weekly sync",
		Color:   "blue",
	}
	ics := eventToICS(ev)

	checks := []string{
		"BEGIN:VCALENDAR",
		"BEGIN:VEVENT",
		"UID:ev_test1@arozos",
		"SUMMARY:Team Meeting",
		"DTSTART:20240315T100000Z",
		"DTEND:20240315T110000Z",
		"LOCATION:Conference Room",
		"DESCRIPTION:Weekly sync",
		"X-APPLE-CALENDAR-COLOR:#4A90D9",
		"END:VEVENT",
		"END:VCALENDAR",
	}
	for _, want := range checks {
		if !strings.Contains(ics, want) {
			t.Errorf("eventToICS: missing %q in output:\n%s", want, ics)
		}
	}
}

func TestEventToICS_AllDay(t *testing.T) {
	ev := CalendarEvent{
		ID:     "ev_allday",
		Title:  "Holiday",
		AllDay: true,
		Start:  time.Date(2024, 12, 25, 0, 0, 0, 0, time.UTC).UnixMilli(),
		End:    time.Date(2024, 12, 26, 0, 0, 0, 0, time.UTC).UnixMilli(),
	}
	ics := eventToICS(ev)
	if !strings.Contains(ics, "DTSTART;VALUE=DATE:20241225") {
		t.Errorf("expected DATE-only DTSTART for all-day event, got:\n%s", ics)
	}
	if strings.Contains(ics, "T") && strings.Contains(ics, "DTSTART") {
		// Only the date-only form should appear for DTSTART
		if strings.Contains(ics, "DTSTART:") {
			t.Errorf("all-day event should not have time-based DTSTART")
		}
	}
}

func TestEventToICS_Reminder(t *testing.T) {
	cases := []struct {
		reminder *EventReminder
		want     string
	}{
		{&EventReminder{Value: 15, Unit: "mins"}, "TRIGGER:-PT15M"},
		{&EventReminder{Value: 2, Unit: "hours"}, "TRIGGER:-PT2H"},
		{&EventReminder{Value: 1, Unit: "days"}, "TRIGGER:-P1D"},
	}
	for _, tc := range cases {
		ev := CalendarEvent{ID: "ev1", Title: "X", Reminder: tc.reminder,
			Start: time.Now().UnixMilli(), End: time.Now().UnixMilli()}
		ics := eventToICS(ev)
		if !strings.Contains(ics, tc.want) {
			t.Errorf("expected %q in ICS for reminder %+v, got:\n%s", tc.want, tc.reminder, ics)
		}
	}
}

func TestICSToEvent_RoundTrip(t *testing.T) {
	original := CalendarEvent{
		ID:      "ev_rt1",
		Title:   "Round Trip",
		AllDay:  false,
		Start:   time.Date(2024, 6, 1, 9, 30, 0, 0, time.UTC).UnixMilli(),
		End:     time.Date(2024, 6, 1, 10, 30, 0, 0, time.UTC).UnixMilli(),
		Address: "Main Hall",
		Notes:   "Test notes",
		Color:   "green",
		Reminder: &EventReminder{Value: 30, Unit: "mins"},
	}

	ics := eventToICS(original)
	parsed, err := icsToEvent(ics, "ev_rt1")
	if err != nil {
		t.Fatalf("icsToEvent returned error: %v", err)
	}

	if parsed.Title != original.Title {
		t.Errorf("Title: got %q want %q", parsed.Title, original.Title)
	}
	if parsed.Start != original.Start {
		t.Errorf("Start: got %d want %d", parsed.Start, original.Start)
	}
	if parsed.End != original.End {
		t.Errorf("End: got %d want %d", parsed.End, original.End)
	}
	if parsed.Address != original.Address {
		t.Errorf("Address: got %q want %q", parsed.Address, original.Address)
	}
	if parsed.Notes != original.Notes {
		t.Errorf("Notes: got %q want %q", parsed.Notes, original.Notes)
	}
	if parsed.Color != original.Color {
		t.Errorf("Color: got %q want %q", parsed.Color, original.Color)
	}
	if parsed.Reminder == nil {
		t.Fatal("Reminder: got nil, want non-nil")
	}
	if parsed.Reminder.Value != original.Reminder.Value || parsed.Reminder.Unit != original.Reminder.Unit {
		t.Errorf("Reminder: got %+v want %+v", parsed.Reminder, original.Reminder)
	}
}

func TestICSToEvent_IDFromURL(t *testing.T) {
	ics := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\n" +
		"UID:some-ios-uid@icloud.com\r\n" +
		"SUMMARY:iOS Event\r\n" +
		"DTSTART:20240101T120000Z\r\n" +
		"DTEND:20240101T130000Z\r\n" +
		"END:VEVENT\r\nEND:VCALENDAR\r\n"

	// idHint from URL should take precedence as canonical ID
	parsed, err := icsToEvent(ics, "url-derived-id")
	if err != nil {
		t.Fatalf("icsToEvent error: %v", err)
	}
	// icsToEvent uses the UID field; caller (handlePut) overwrites with URL id
	if parsed.Title != "iOS Event" {
		t.Errorf("Title: got %q want %q", parsed.Title, "iOS Event")
	}
}

func TestTriggerToReminder(t *testing.T) {
	cases := []struct {
		trigger string
		want    *EventReminder
	}{
		{"-PT15M", &EventReminder{Value: 15, Unit: "mins"}},
		{"-PT2H", &EventReminder{Value: 2, Unit: "hours"}},
		{"-P1D", &EventReminder{Value: 1, Unit: "days"}},
		{"PT15M", nil},  // positive trigger – ignore
		{"invalid", nil},
	}
	for _, tc := range cases {
		got := triggerToReminder(tc.trigger)
		if tc.want == nil {
			if got != nil {
				t.Errorf("triggerToReminder(%q): want nil, got %+v", tc.trigger, got)
			}
			continue
		}
		if got == nil {
			t.Errorf("triggerToReminder(%q): want %+v, got nil", tc.trigger, tc.want)
			continue
		}
		if got.Value != tc.want.Value || got.Unit != tc.want.Unit {
			t.Errorf("triggerToReminder(%q): got %+v want %+v", tc.trigger, got, tc.want)
		}
	}
}

func TestUnfoldICSLines(t *testing.T) {
	input := "BEGIN:VCALENDAR\r\nSUMMARY:Long \r\n Title\r\nEND:VCALENDAR\r\n"
	lines := unfoldICSLines(input)
	found := false
	for _, l := range lines {
		if l == "SUMMARY:Long Title" {
			found = true
		}
	}
	if !found {
		t.Errorf("unfoldICSLines: continuation line not joined; got %v", lines)
	}
}

func TestCollectionCTag_ChangesWithEvents(t *testing.T) {
	ev1 := []CalendarEvent{{ID: "a", Title: "A"}}
	ev2 := []CalendarEvent{{ID: "a", Title: "A"}, {ID: "b", Title: "B"}}
	if collectionCTag(ev1) == collectionCTag(ev2) {
		t.Error("collectionCTag should differ when events differ")
	}
}

func TestSplitURLPath(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"/", []string{}},
		{"", []string{}},
		{"/alice/calendar/", []string{"alice", "calendar"}},
		{"/alice/calendar/ev1.ics", []string{"alice", "calendar", "ev1.ics"}},
	}
	for _, tc := range cases {
		got := splitURLPath(tc.in)
		if len(got) != len(tc.want) {
			t.Errorf("splitURLPath(%q): got %v want %v", tc.in, got, tc.want)
			continue
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Errorf("splitURLPath(%q)[%d]: got %q want %q", tc.in, i, got[i], tc.want[i])
			}
		}
	}
}

func TestExtractEventID(t *testing.T) {
	cases := []struct {
		path string
		want string
	}{
		{"/alice/calendar/ev_abc.ics", "ev_abc"},
		{"/alice/calendar/", ""},
		{"/alice/", ""},
	}
	for _, tc := range cases {
		got := extractEventID(tc.path)
		if got != tc.want {
			t.Errorf("extractEventID(%q): got %q want %q", tc.path, got, tc.want)
		}
	}
}

func TestHrefsToIDSet(t *testing.T) {
	body := `<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:href>/caldav/alice/calendar/ev1.ics</D:href>
  <D:href>/caldav/alice/calendar/ev2.ics</D:href>
</C:calendar-multiget>`
	calHref := "/caldav/alice/calendar/"
	ids := hrefsToIDSet(body, calHref)
	if !ids["ev1"] {
		t.Error("hrefsToIDSet: missing ev1")
	}
	if !ids["ev2"] {
		t.Error("hrefsToIDSet: missing ev2")
	}
	if len(ids) != 2 {
		t.Errorf("hrefsToIDSet: expected 2 IDs, got %d", len(ids))
	}
}
