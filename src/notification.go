package main

import (
	"errors"

	fs "imuslab.com/arozos/mod/filesystem"
	notification "imuslab.com/arozos/mod/notification"
	"imuslab.com/arozos/mod/notification/agents/desktopn"
	"imuslab.com/arozos/mod/notification/agents/smtpn"
	"imuslab.com/arozos/mod/notification/agents/telegram"
	"imuslab.com/arozos/mod/notification/agents/webhookn"
	"imuslab.com/arozos/mod/notification/preference"
)

/*
	Notification System Wiring

	This file constructs the ArozOS core notification queue, registers all the
	delivery agents (email, Telegram, desktop, custom webhook) and exposes a
	preference-aware router (sendUserNotification) used by the AGI notification
	library and the notification settings endpoints.

	Delivery routing:
	  A producer raises a NotificationPayload (with a priority) for one or more
	  receivers. For each receiver, their personal preferences decide which
	  registered agents actually deliver it and whether the notification meets
	  their minimum priority threshold.
*/

const (
	smtpnConfigPath    = "./system/smtp_conf.json"
	telegramConfigPath = "./system/telegram_conf.json"
)

var (
	notificationQueue           *notification.NotificationQueue
	notificationPreferenceStore *preference.Store
	desktopNotificationAgent    *desktopn.Agent
	telegramNotificationAgent   *telegram.Agent
	smtpNotificationAgent       *smtpn.Agent
)

func notificationInit() {
	//Create a new notification queue
	notificationQueue = notification.NewNotificationQueue()

	//Create the per-user preference store backed by the system database
	store, err := preference.NewStore(userHandler.GetDatabase())
	if err != nil {
		systemWideLogger.PrintAndLog("Notification", "Unable to init notification preference store: "+err.Error(), err)
	}
	notificationPreferenceStore = store

	/*
		SMTP (Email) Notification Agent
		For handling notification sending via Mail
	*/
	if !fs.FileExists(smtpnConfigPath) {
		smtpn.GenerateEmptyConfigFile(smtpnConfigPath)
	}
	smtpAgent, err := smtpn.NewSMTPNotificationAgent(*host_name, smtpnConfigPath,
		func(username string) (string, error) {
			return registerHandler.GetUserEmail(username)
		})
	if err != nil {
		systemWideLogger.PrintAndLog("Notification", "Unable to start smtpn agent: "+err.Error(), nil)
	} else {
		smtpAgent.SystemVersion = build_version + " v" + internal_version
		smtpNotificationAgent = smtpAgent
		notificationQueue.RegisterNotificationAgent(smtpAgent)
	}

	/*
		Telegram Notification Agent
		Delivers notifications through a Telegram bot; per-user chat ids come
		from the notification preference store.
	*/
	if !fs.FileExists(telegramConfigPath) {
		telegram.GenerateEmptyConfigFile(telegramConfigPath)
	}
	telegramAgent, err := telegram.NewTelegramNotificationAgent(telegramConfigPath, telegramChatIDResolver())
	if err != nil {
		systemWideLogger.PrintAndLog("Notification", "Unable to start telegram agent: "+err.Error(), nil)
	} else {
		telegramNotificationAgent = telegramAgent
		notificationQueue.RegisterNotificationAgent(telegramAgent)
	}

	/*
		Desktop Notification Agent
		Buffers notifications in memory so the web desktop can poll and render
		them (notification list, desktop popup, browser push).
	*/
	desktopNotificationAgent = desktopn.NewDesktopNotificationAgent()
	notificationQueue.RegisterNotificationAgent(desktopNotificationAgent)

	/*
		Custom HTML API (Webhook) Notification Agent
		Delivers notifications to a per-user configurable HTTP endpoint.
	*/
	webhookAgent := webhookn.NewWebhookNotificationAgent(webhookTargetResolver())
	notificationQueue.RegisterNotificationAgent(webhookAgent)

	systemWideLogger.PrintAndLog("Notification", "Notification system started with agents: "+joinStrings(notificationQueue.ListConsumerAgentNames()), nil)
}

// telegramChatIDResolver returns a resolver that reads the per-user Telegram
// chat id from the preference store (nil-safe).
func telegramChatIDResolver() func(string) (string, error) {
	return func(username string) (string, error) {
		if notificationPreferenceStore == nil {
			return "", errNotificationStoreUnavailable
		}
		return notificationPreferenceStore.TelegramChatIDResolver()(username)
	}
}

// webhookTargetResolver returns a resolver that reads the per-user webhook
// target from the preference store (nil-safe).
func webhookTargetResolver() func(string) (webhookn.Target, error) {
	return func(username string) (webhookn.Target, error) {
		if notificationPreferenceStore == nil {
			return webhookn.Target{}, errNotificationStoreUnavailable
		}
		return notificationPreferenceStore.WebhookResolver()(username)
	}
}

var errNotificationStoreUnavailable = errors.New("notification preference store unavailable")

// sendUserNotification is the preference-aware router. For each receiver, it
// resolves the delivery agents according to that user's preferences and
// priority threshold, then broadcasts a per-user copy through the queue.
// This is the entry point used by the AGI notification library.
func sendUserNotification(payload *notification.NotificationPayload) error {
	if notificationQueue == nil {
		return errors.New("notification system not initialised")
	}
	if payload == nil {
		return errors.New("nil notification payload")
	}

	payload.Priority = notification.NormalizePriority(payload.Priority)
	availableAgents := notificationQueue.ListConsumerAgentNames()

	for _, username := range payload.Receiver {
		var targetAgents []string
		if notificationPreferenceStore != nil {
			targetAgents = notificationPreferenceStore.ResolveAgents(username, payload.Priority, availableAgents, payload.ReciverAgents)
		} else {
			//No preference store: fall back to producer-requested agents (or none).
			targetAgents = payload.ReciverAgents
		}
		if len(targetAgents) == 0 {
			//Nothing enabled for this user at this priority; skip.
			continue
		}

		perUser := *payload
		perUser.Receiver = []string{username}
		perUser.ReciverAgents = targetAgents
		notificationQueue.BroadcastNotification(&perUser)
	}
	return nil
}

// joinStrings joins a slice with ", " without pulling in strings just for one call site.
func joinStrings(items []string) string {
	out := ""
	for i, item := range items {
		if i > 0 {
			out += ", "
		}
		out += item
	}
	return out
}
