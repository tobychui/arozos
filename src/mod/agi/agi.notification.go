package agi

/*
	AGI Notification Library
	Author: tobychui

	This library allows AGI scripts to raise notifications to ArozOS users
	through the core notification system. The delivery channel (Telegram,
	desktop, email, custom webhook) is decided by each receiving user's own
	notification preferences; the script only chooses the priority
	(low / medium / high) so users receive it according to their settings.

	Usage (from an AGI script):
		requirelib("notification");
		notification.send("Backup done", "Your nightly backup finished");
		notification.send("Disk failing", "SMART error on /dev/sda", "high");
		notification.sendToUser("bob", "Hi Bob", "A message for you", "low"); //admin only
*/

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/robertkrimen/otto"
	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/info/logger"
	notification "imuslab.com/arozos/mod/notification"
	user "imuslab.com/arozos/mod/user"
)

func (g *Gateway) NotificationLibRegister() {
	err := g.RegisterLib("notification", g.injectNotificationLibFunctions)
	if err != nil {
		logger.PrintAndLog("Agi", fmt.Sprint(err), nil)
		os.Exit(1)
	}
}

// buildAndSendNotification constructs a NotificationPayload from the given
// fields and routes it through the configured notification sender.
func (g *Gateway) buildAndSendNotification(sender string, receivers []string, title string, message string, priority string) error {
	if g.Option.NotificationSender == nil {
		return errors.New("notification system is not available")
	}
	if title == "" {
		return errors.New("notification title cannot be empty")
	}

	payload := &notification.NotificationPayload{
		ID:        strconv.FormatInt(time.Now().UnixNano(), 10) + "-" + uuid.NewV4().String(),
		Title:     title,
		Message:   message,
		Receiver:  receivers,
		Sender:    sender,
		Priority:  notification.PriorityFromString(priority),
		Timestamp: time.Now().Unix(),
	}
	return g.Option.NotificationSender(payload)
}

func (g *Gateway) injectNotificationLibFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	u := payload.User

	//The sender label shown to the user is the script's module root.
	senderLabel := "AGI Script"
	if payload.ScriptPath != "" {
		senderLabel = static.GetScriptRoot(payload.ScriptPath, "./web/")
	}

	// notification.send(title, message, [priority]) -> bool
	// Sends a notification to the current user.
	vm.Set("_notification_send", func(call otto.FunctionCall) otto.Value {
		title, err := call.Argument(0).ToString()
		if err != nil || title == "undefined" {
			g.RaiseError(errors.New("title is undefined"))
			return otto.FalseValue()
		}
		message, _ := call.Argument(1).ToString()
		if message == "undefined" {
			message = ""
		}
		priority := "medium"
		if !call.Argument(2).IsUndefined() {
			priority, _ = call.Argument(2).ToString()
		}

		if err := g.buildAndSendNotification(senderLabel, []string{u.Username}, title, message, priority); err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	// notification.sendToUser(username, title, message, [priority]) -> bool
	// Sends a notification to another user. Requires admin permission.
	vm.Set("_notification_sendToUser", func(call otto.FunctionCall) otto.Value {
		if !u.IsAdmin() {
			g.RaiseError(errors.New("Permission Denied: sendToUser require admin permission"))
			return otto.FalseValue()
		}

		username, err := call.Argument(0).ToString()
		if err != nil || username == "undefined" {
			g.RaiseError(errors.New("username is undefined"))
			return otto.FalseValue()
		}

		//Validate the target user actually exists.
		if !g.userExistsForNotification(u, username) {
			g.RaiseError(errors.New(username + " does not exist"))
			return otto.FalseValue()
		}

		title, err := call.Argument(1).ToString()
		if err != nil || title == "undefined" {
			g.RaiseError(errors.New("title is undefined"))
			return otto.FalseValue()
		}
		message, _ := call.Argument(2).ToString()
		if message == "undefined" {
			message = ""
		}
		priority := "medium"
		if !call.Argument(3).IsUndefined() {
			priority, _ = call.Argument(3).ToString()
		}

		if err := g.buildAndSendNotification(senderLabel, []string{username}, title, message, priority); err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	//Wrap the native functions into a notification object with priority
	//constants for convenience.
	vm.Run(`
		var notification = {};
		notification.PRIORITY_LOW = "low";
		notification.PRIORITY_MEDIUM = "medium";
		notification.PRIORITY_HIGH = "high";
		notification.send = _notification_send;
		notification.sendToUser = _notification_sendToUser;
	`)
}

// userExistsForNotification checks whether the given username exists in the
// system, guarding the admin-only sendToUser call.
func (g *Gateway) userExistsForNotification(u *user.User, username string) bool {
	if g.Option.UserHandler == nil {
		return false
	}
	return u.Parent().GetAuthAgent().UserExists(username)
}
