package share

/*
	Share invitation notices

	Inviting a user or a group grants access straight away - there is nothing
	to accept. The invited people get an ArozOS notification as a reminder that
	they can now open the file, with the share link as its click target.
*/

import (
	"encoding/json"
	"strconv"
	"time"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/notification"
	"imuslab.com/arozos/mod/share/shareEntry"
)

const notificationSender = "File Share"

// invitedNames returns the user or group names newly given access by a share
// change. before is nil for a new share.
func invitedNames(before *shareEntry.ShareOption, after *shareEntry.ShareOption) (out0 []string) {
	defer logger.Out1(logger.In2("share", "invitedNames", "before", before, "after", after), &out0)
	if after.Permission != shareEntry.PermissionUsers && after.Permission != shareEntry.PermissionGroups {
		return []string{}
	}

	previous := map[string]bool{}
	if before != nil && before.Permission == after.Permission {
		for _, name := range before.Accessibles {
			previous[name] = true
		}
	}

	added := []string{}
	for _, name := range after.Accessibles {
		if !previous[name] {
			added = append(added, name)
		}
	}
	return added
}

// resolveInvitees expands invited users / groups into the usernames to notify,
// without duplicates and without the person who shared the file.
func (s *Manager) resolveInvitees(so *shareEntry.ShareOption, names []string, sharedBy string) (out0 []string) {
	defer logger.Out1(logger.In4("share", "Manager.resolveInvitees", "s", s, "so", so, "names", names, "sharedBy", sharedBy), &out0)
	seen := map[string]bool{so.Owner: true, sharedBy: true}
	receivers := []string{}
	add := func(username string) {
		if !seen[username] {
			seen[username] = true
			receivers = append(receivers, username)
		}
	}

	for _, name := range names {
		if so.Permission == shareEntry.PermissionUsers {
			add(name)
			continue
		}
		members, err := s.options.UserHandler.GetUsersInPermissionGroup(name)
		if err != nil {
			logger.DebugErr("share", err)
			continue
		}
		for _, member := range members {
			add(member.Username)
		}
	}
	return receivers
}

// buildInviteNotification builds the notice sent to invited users
func buildInviteNotification(so *shareEntry.ShareOption, sharedBy string, receivers []string) (out0 *notification.NotificationPayload) {
	defer logger.Out1(logger.In3("share", "buildInviteNotification", "so", so, "sharedBy", sharedBy, "receivers", receivers), &out0)
	filename := arozfs.Base(so.FileVirtualPath)
	kind := "file"
	if so.IsFolder {
		kind = "folder"
	}
	access := "view"
	if so.AccessLevel == shareEntry.AccessLevelEdit {
		access = "view and upload to"
	}

	message := sharedBy + " shared the " + kind + " \"" + filename + "\" with you. You can now " + access + " it, no action needed."
	if so.ExpireAt > 0 {
		message += " Access ends on " + time.Unix(so.ExpireAt, 0).Format("2006-01-02") + "."
	}

	//Float window options the desktop opens when the notification is clicked
	openOption, _ := json.Marshal(map[string]interface{}{
		"url":     "share/" + so.UUID + "/",
		"title":   filename,
		"appicon": "SystemAO/file_system/img/share.svg",
		"width":   960,
		"height":  640,
	})

	return &notification.NotificationPayload{
		ID:        strconv.FormatInt(time.Now().UnixNano(), 10) + "-" + uuid.NewV4().String(),
		Title:     "A " + kind + " was shared with you",
		Message:   message,
		Receiver:  receivers,
		Sender:    notificationSender,
		Priority:  notification.PriorityMedium,
		Timestamp: time.Now().Unix(),
		Payload:   string(openOption),
	}
}

// notifyInvitees tells the people newly invited by a share change that they
// now have access. before is nil for a new share. Failures are only logged:
// the share itself has already been saved.
func (s *Manager) notifyInvitees(before *shareEntry.ShareOption, after *shareEntry.ShareOption, sharedBy string) {
	defer logger.Out0(logger.In4("share", "Manager.notifyInvitees", "s", s, "before", before, "after", after, "sharedBy", sharedBy))
	if s.options.NotificationSender == nil || after == nil || after.IsExpired(time.Now()) {
		return
	}

	names := invitedNames(before, after)
	if len(names) == 0 {
		return
	}

	receivers := s.resolveInvitees(after, names, sharedBy)
	if len(receivers) == 0 {
		return
	}

	if err := s.options.NotificationSender(buildInviteNotification(after, sharedBy, receivers)); err != nil {
		logger.DebugErr("share", err)
		logger.PrintAndLog("Share", "Unable to notify invited users of share "+after.UUID, err)
	}
}
