package caldav

/*
	ics.go - ICS / iCalendar conversion helpers

	Converts between ArozOS CalendarEvent (JSON) and the iCalendar format
	(RFC 5545) used by CalDAV.  Only the subset needed for iOS Calendar
	bidirectional sync is handled.
*/

import (
	"crypto/md5"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// eventToICS serialises a CalendarEvent as a VCALENDAR / VEVENT string.
func eventToICS(ev CalendarEvent) string {
	var sb strings.Builder
	sb.WriteString("BEGIN:VCALENDAR\r\n")
	sb.WriteString("VERSION:2.0\r\n")
	sb.WriteString("PRODID:-//ArozOS//CalDAV//EN\r\n")
	sb.WriteString("BEGIN:VEVENT\r\n")
	sb.WriteString("UID:" + ev.ID + "@arozos\r\n")
	sb.WriteString("SUMMARY:" + escapeICSText(ev.Title) + "\r\n")

	if ev.AllDay {
		startT := time.UnixMilli(ev.Start).UTC()
		endT := time.UnixMilli(ev.End).UTC()
		sb.WriteString("DTSTART;VALUE=DATE:" + startT.Format("20060102") + "\r\n")
		sb.WriteString("DTEND;VALUE=DATE:" + endT.Format("20060102") + "\r\n")
	} else {
		startT := time.UnixMilli(ev.Start).UTC()
		endT := time.UnixMilli(ev.End).UTC()
		sb.WriteString("DTSTART:" + startT.Format("20060102T150405Z") + "\r\n")
		sb.WriteString("DTEND:" + endT.Format("20060102T150405Z") + "\r\n")
	}

	if ev.Address != "" {
		sb.WriteString("LOCATION:" + escapeICSText(ev.Address) + "\r\n")
	}
	if ev.Notes != "" {
		sb.WriteString("DESCRIPTION:" + escapeICSText(ev.Notes) + "\r\n")
	}
	if ev.Color != "" {
		if hex := arozColorToHex(ev.Color); hex != "" {
			sb.WriteString("X-APPLE-CALENDAR-COLOR:" + hex + "\r\n")
		}
	}
	if ev.Reminder != nil {
		trigger := reminderToTrigger(ev.Reminder)
		sb.WriteString("BEGIN:VALARM\r\n")
		sb.WriteString("TRIGGER:" + trigger + "\r\n")
		sb.WriteString("ACTION:DISPLAY\r\n")
		sb.WriteString("DESCRIPTION:Reminder\r\n")
		sb.WriteString("END:VALARM\r\n")
	}

	sb.WriteString("END:VEVENT\r\n")
	sb.WriteString("END:VCALENDAR\r\n")
	return sb.String()
}

// icsToEvent parses a VCALENDAR string and returns a CalendarEvent.
// idHint is used as the event ID when the UID is absent or needs normalising.
func icsToEvent(icsData string, idHint string) (CalendarEvent, error) {
	lines := unfoldICSLines(icsData)

	ev := CalendarEvent{
		ID:    idHint,
		Color: "blue",
	}

	inVEvent := false
	inVAlarm := false
	var alarmTrigger string

	for _, line := range lines {
		switch line {
		case "BEGIN:VEVENT":
			inVEvent = true
			continue
		case "END:VEVENT":
			inVEvent = false
			continue
		case "BEGIN:VALARM":
			inVAlarm = true
			continue
		case "END:VALARM":
			inVAlarm = false
			continue
		}

		if !inVEvent {
			continue
		}

		if inVAlarm {
			if strings.HasPrefix(strings.ToUpper(line), "TRIGGER") {
				_, val := splitICSLine(line)
				alarmTrigger = strings.TrimSpace(val)
			}
			continue
		}

		key, val := splitICSLine(line)
		baseKey := strings.ToUpper(strings.Split(key, ";")[0])

		switch baseKey {
		case "UID":
			uid := unescapeICSText(strings.TrimSpace(val))
			uid = strings.TrimSuffix(uid, "@arozos")
			if uid != "" {
				ev.ID = uid
			}
		case "SUMMARY":
			ev.Title = unescapeICSText(val)
		case "LOCATION":
			ev.Address = unescapeICSText(val)
		case "DESCRIPTION":
			ev.Notes = unescapeICSText(val)
		case "X-APPLE-CALENDAR-COLOR":
			ev.Color = hexToArozColor(strings.TrimSpace(val))
		case "DTSTART":
			t, allDay := parseICSDateTime(key, val)
			ev.Start = t.UnixMilli()
			ev.AllDay = allDay
		case "DTEND":
			t, _ := parseICSDateTime(key, val)
			ev.End = t.UnixMilli()
		}
	}

	if alarmTrigger != "" {
		ev.Reminder = triggerToReminder(alarmTrigger)
	}

	return ev, nil
}

// unfoldICSLines normalises line endings and joins continuation lines.
func unfoldICSLines(data string) []string {
	data = strings.ReplaceAll(data, "\r\n", "\n")
	data = strings.ReplaceAll(data, "\r", "\n")
	raw := strings.Split(data, "\n")

	var lines []string
	for _, line := range raw {
		if len(line) == 0 {
			continue
		}
		if (line[0] == ' ' || line[0] == '\t') && len(lines) > 0 {
			lines[len(lines)-1] += line[1:]
		} else {
			lines = append(lines, line)
		}
	}
	return lines
}

// splitICSLine splits "KEY;PARAMS:VALUE" at the first colon.
func splitICSLine(line string) (string, string) {
	idx := strings.Index(line, ":")
	if idx < 0 {
		return line, ""
	}
	return line[:idx], line[idx+1:]
}

func parseICSDateTime(key, val string) (time.Time, bool) {
	val = strings.TrimSpace(val)
	if strings.Contains(strings.ToUpper(key), "VALUE=DATE") {
		t, err := time.Parse("20060102", val)
		if err != nil {
			return time.Now().UTC(), true
		}
		return t.UTC(), true
	}
	if strings.HasSuffix(val, "Z") {
		t, err := time.Parse("20060102T150405Z", val)
		if err != nil {
			return time.Now().UTC(), false
		}
		return t.UTC(), false
	}
	t, err := time.Parse("20060102T150405", val)
	if err != nil {
		return time.Now().UTC(), false
	}
	return t.UTC(), false
}

// escapeICSText escapes special characters per RFC 5545 §3.3.11.
func escapeICSText(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, ";", "\\;")
	s = strings.ReplaceAll(s, ",", "\\,")
	s = strings.ReplaceAll(s, "\n", "\\n")
	s = strings.ReplaceAll(s, "\r", "")
	return s
}

func unescapeICSText(s string) string {
	s = strings.ReplaceAll(s, "\\n", "\n")
	s = strings.ReplaceAll(s, "\\N", "\n")
	s = strings.ReplaceAll(s, "\\;", ";")
	s = strings.ReplaceAll(s, "\\,", ",")
	s = strings.ReplaceAll(s, "\\\\", "\\")
	return s
}

// arozColorToHex maps the ArozOS colour names to Apple iCal hex codes.
func arozColorToHex(color string) string {
	switch color {
	case "blue":
		return "#4A90D9"
	case "red":
		return "#D94040"
	case "orange":
		return "#E87C25"
	case "green":
		return "#56B969"
	case "purple":
		return "#8E6BAD"
	case "teal":
		return "#1BAFD6"
	default:
		return ""
	}
}

// hexToArozColor maps a hex colour string back to an ArozOS colour name.
func hexToArozColor(hex string) string {
	switch strings.ToUpper(hex) {
	case "#4A90D9", "#007AFF", "#0000FF":
		return "blue"
	case "#D94040", "#FF0000", "#FF3B30":
		return "red"
	case "#E87C25", "#FF8C00", "#FF9500":
		return "orange"
	case "#56B969", "#00FF00", "#34C759", "#008000":
		return "green"
	case "#8E6BAD", "#800080", "#AF52DE":
		return "purple"
	case "#1BAFD6", "#008080", "#5AC8FA":
		return "teal"
	default:
		return "blue"
	}
}

// reminderToTrigger converts an EventReminder to a VALARM TRIGGER value.
func reminderToTrigger(r *EventReminder) string {
	if r == nil {
		return "-PT15M"
	}
	switch r.Unit {
	case "hours":
		return fmt.Sprintf("-PT%dH", r.Value)
	case "days":
		return fmt.Sprintf("-P%dD", r.Value)
	default: // "mins"
		return fmt.Sprintf("-PT%dM", r.Value)
	}
}

// triggerToReminder parses a VALARM TRIGGER string into an EventReminder.
// Only the common negative-duration forms used by iOS are handled.
func triggerToReminder(trigger string) *EventReminder {
	trigger = strings.TrimSpace(trigger)
	if !strings.HasPrefix(trigger, "-P") {
		return nil
	}
	s := trigger[2:] // strip "-P"
	if strings.HasPrefix(s, "T") {
		s = s[1:] // strip "T" time-designator
	}
	if strings.HasSuffix(s, "M") {
		v, err := strconv.Atoi(s[:len(s)-1])
		if err != nil {
			return nil
		}
		return &EventReminder{Value: v, Unit: "mins"}
	}
	if strings.HasSuffix(s, "H") {
		v, err := strconv.Atoi(s[:len(s)-1])
		if err != nil {
			return nil
		}
		return &EventReminder{Value: v, Unit: "hours"}
	}
	if strings.HasSuffix(s, "D") {
		v, err := strconv.Atoi(s[:len(s)-1])
		if err != nil {
			return nil
		}
		return &EventReminder{Value: v, Unit: "days"}
	}
	return nil
}

// eventETag returns a quoted MD5 ETag for the given event.
func eventETag(ev CalendarEvent) string {
	data, _ := json.Marshal(ev)
	h := md5.Sum(data)
	return fmt.Sprintf(`"%x"`, h)
}

// collectionCTag returns an unquoted MD5 sync token for the whole collection.
func collectionCTag(events []CalendarEvent) string {
	data, _ := json.Marshal(events)
	h := md5.Sum(data)
	return fmt.Sprintf("%x", h)
}
