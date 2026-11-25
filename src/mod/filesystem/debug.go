package filesystem

import (
	"fmt"
	"reflect"
	"strconv"
	"strings"
)

/*
	debug.go

	Descriptions of drive handlers and their start options for DEBUG log
	lines (see logger.Debug). They never fail on a half built handler, since
	those are what a crash trace is usually after, and never hold a
	password.
*/

// DebugString describes a drive handler in one line, as
//
//	"Photos" (photos:/ ext4 public rw, *localfs.LocalFileSystemAbstraction)
//
// It names a missing or nil pointer abstraction and a closed handler, the
// two states that turn later calls on the handler into a panic.
func (fsh *FileSystemHandler) DebugString() string {
	if fsh == nil {
		return "<nil drive handler>"
	}
	access := "rw"
	if fsh.ReadOnly {
		access = "ro"
	}
	details := []string{fsh.UUID + ":/", orDash(fsh.Filesystem), orDash(fsh.Hierarchy), access}
	description := strconv.Quote(fsh.Name) + " (" + strings.Join(details, " ") + ", " + DebugAbstractionType(fsh.FileSystemAbstraction)
	if fsh.Closed {
		description += ", CLOSED"
	}
	return description + ")"
}

// HandlerDescription prints as the DebugString of a drive handler. It holds
// only the pointer, so passing one to logger.Debugf costs nothing while
// debug is off: the description is built when the line is written.
type HandlerDescription struct {
	fsh *FileSystemHandler
}

func (d HandlerDescription) String() string {
	return d.fsh.DebugString()
}

// Describe returns fsh for a logger.Debugf argument, described as by
// DebugString only if the debug line is written. Use it instead of
// DebugString in debug lines on paths every request takes.
func (fsh *FileSystemHandler) Describe() HandlerDescription {
	return HandlerDescription{fsh: fsh}
}

// DebugAbstractionType names the type of a file system abstraction, and
// says when it is nil or a nil pointer: calling a method on either panics
func DebugAbstractionType(fsa FileSystemAbstraction) string {
	if fsa == nil {
		return "abstraction <nil>"
	}
	name := fmt.Sprintf("%T", fsa)
	value := reflect.ValueOf(fsa)
	switch value.Kind() {
	case reflect.Pointer, reflect.Map, reflect.Slice, reflect.Interface, reflect.Func, reflect.Chan:
		if value.IsNil() {
			return name + " <nil pointer>"
		}
	}
	return name
}

// DebugString describes a drive's start options in one line. The password
// is left out; only whether one is set is shown.
func (option FileSystemOption) DebugString() string {
	parts := []string{
		"name=" + strconv.Quote(option.Name),
		"uuid=" + option.Uuid,
		"fs=" + orDash(option.Filesystem),
		"path=" + strconv.Quote(option.Path),
		"hierarchy=" + orDash(option.Hierarchy),
		"access=" + orDash(option.Access),
	}
	if option.Automount {
		parts = append(parts, "automount=true", "mountdev="+orDash(option.Mountdev), "mountpt="+strconv.Quote(option.Mountpt))
	}
	if option.DiskUUID != "" {
		parts = append(parts, "diskuuid="+option.DiskUUID)
	}
	if option.Username != "" {
		parts = append(parts, "username="+strconv.Quote(option.Username))
	}
	if option.Password != "" {
		parts = append(parts, "password=<set>")
	}
	return strings.Join(parts, " ")
}

// DebugHandlerList describes a list of drive handlers as their ids, for
// one line listing what a pool holds
func DebugHandlerList(handlers []*FileSystemHandler) string {
	ids := make([]string, 0, len(handlers))
	for _, fsh := range handlers {
		if fsh == nil {
			ids = append(ids, "<nil>")
			continue
		}
		id := fsh.UUID + ":/"
		if fsh.FileSystemAbstraction == nil {
			id += "(no abstraction)"
		}
		if fsh.Closed {
			id += "(closed)"
		}
		ids = append(ids, id)
	}
	return "[" + strings.Join(ids, ", ") + "]"
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}
