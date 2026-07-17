package main

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	notification "imuslab.com/arozos/mod/notification"
	"imuslab.com/arozos/mod/notification/agents/webhookn"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/utils"
)

/*
	Notification Settings

	Registers the "Notifications" tab in System Settings and the endpoints that
	back both the per-user preference UI (any logged-in user) and the
	admin-only agent configuration (Telegram bot token, SMTP credentials).

	User endpoints (login required):
	  GET  /system/notification/agents        – list delivery agents + availability
	  GET  /system/notification/preference     – current user's preferences
	  POST /system/notification/preference     – save current user's preferences
	  GET  /system/notification/desktop/list   – poll + clear desktop notifications
	  POST /system/notification/test           – send a test notification to self

	Admin endpoints (admin required):
	  GET/POST /system/notification/config/telegram – Telegram bot token
	  GET/POST /system/notification/config/smtp      – SMTP credentials
*/

func NotificationSettingInit() {
	//Register the settings tab. It is visible to all users; the admin-only
	//sections are hidden client side and enforced server side.
	registerSetting(settingModule{
		Name:         "Notifications",
		Desc:         "Choose how you receive notifications and configure delivery agents",
		IconPath:     "SystemAO/notification/img/small_icon.svg",
		Group:        "Desktop",
		StartDir:     "SystemAO/notification/index.html",
		RequireAdmin: false,
	})

	//Router for endpoints available to any logged-in user.
	userRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	userRouter.HandleFunc("/system/notification/agents", handleNotificationAgentList)
	userRouter.HandleFunc("/system/notification/preference", handleNotificationPreference)
	userRouter.HandleFunc("/system/notification/desktop/list", handleDesktopNotificationList)
	userRouter.HandleFunc("/system/notification/test", handleNotificationTest)

	//Admin-only router for agent configuration (holds secrets).
	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	adminRouter.HandleFunc("/system/notification/config/telegram", handleTelegramConfig)
	adminRouter.HandleFunc("/system/notification/config/smtp", handleSMTPConfig)
}

// notificationAgentInfo is the JSON shape describing a delivery agent for the UI.
type notificationAgentInfo struct {
	Name              string `json:"name"`
	Desc              string `json:"desc"`
	Available         bool   `json:"available"`         //Whether the agent can deliver at all (admin-level config present)
	RequiresUserSetup bool   `json:"requiresUserSetup"` //Whether the user must provide per-user info (chat id / webhook)
}

func handleNotificationAgentList(w http.ResponseWriter, r *http.Request) {
	if notificationQueue == nil {
		utils.SendErrorResponse(w, "Notification system not ready")
		return
	}

	agents := []notificationAgentInfo{}
	for _, name := range notificationQueue.ListConsumerAgentNames() {
		agent := notificationQueue.GetAgentByName(name)
		if agent == nil {
			continue
		}
		info := notificationAgentInfo{
			Name:      name,
			Desc:      agent.Desc(),
			Available: true,
		}
		switch name {
		case "telegram":
			info.Available = telegramNotificationAgent != nil && telegramNotificationAgent.IsConfigured()
			info.RequiresUserSetup = true
		case "smtpn":
			info.Available = smtpConfigured()
		case "webhook":
			info.RequiresUserSetup = true
		}
		agents = append(agents, info)
	}

	js, _ := json.Marshal(agents)
	utils.SendJSONResponse(w, string(js))
}

func handleNotificationPreference(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}
	if notificationPreferenceStore == nil {
		utils.SendErrorResponse(w, "Notification preference store not ready")
		return
	}

	if r.Method == http.MethodGet {
		pref := notificationPreferenceStore.Get(userinfo.Username)
		js, _ := json.Marshal(pref)
		utils.SendJSONResponse(w, string(js))
		return
	}

	//POST: save preference
	pref := notificationPreferenceStore.Get(userinfo.Username)

	if enabledAgents, err := utils.PostPara(r, "enabledAgents"); err == nil {
		parsed := map[string]bool{}
		if jsonErr := json.Unmarshal([]byte(enabledAgents), &parsed); jsonErr == nil {
			pref.EnabledAgents = parsed
		}
	}

	if minPriority, err := utils.PostPara(r, "minPriority"); err == nil {
		pref.MinPriority = parsePriority(minPriority)
	}

	if chatID, err := utils.PostPara(r, "telegramChatID"); err == nil {
		pref.TelegramChatID = strings.TrimSpace(chatID)
	}

	if webhookURL, err := utils.PostPara(r, "webhookURL"); err == nil {
		pref.Webhook.URL = strings.TrimSpace(webhookURL)
	}
	if webhookMethod, err := utils.PostPara(r, "webhookMethod"); err == nil {
		pref.Webhook.Method = strings.TrimSpace(webhookMethod)
	}
	if webhookContentType, err := utils.PostPara(r, "webhookContentType"); err == nil {
		pref.Webhook.ContentType = strings.TrimSpace(webhookContentType)
	}
	if webhookBody, err := utils.PostPara(r, "webhookBody"); err == nil {
		pref.Webhook.BodyTemplate = webhookBody
	}

	//Reject an invalid webhook URL early so the user gets feedback.
	if pref.Webhook.URL != "" {
		if err := webhookn.ValidateTarget(pref.Webhook); err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
	}

	if err := notificationPreferenceStore.Set(userinfo.Username, pref); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

func handleDesktopNotificationList(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}
	if desktopNotificationAgent == nil {
		utils.SendJSONResponse(w, "[]")
		return
	}
	items := desktopNotificationAgent.PollNotifications(userinfo.Username)
	js, _ := json.Marshal(items)
	utils.SendJSONResponse(w, string(js))
}

func handleNotificationTest(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	priority := notification.PriorityMedium
	if p, err := utils.PostPara(r, "priority"); err == nil {
		priority = parsePriority(p)
	}

	payload := &notification.NotificationPayload{
		ID:        strconv.FormatInt(time.Now().UnixNano(), 10),
		Title:     "Test Notification",
		Message:   "This is a test notification from your ArozOS notification settings.",
		Receiver:  []string{userinfo.Username},
		Sender:    "Notification Settings",
		Priority:  priority,
		Timestamp: time.Now().Unix(),
	}

	//An explicit agent may be requested for a targeted test.
	if agent, err := utils.PostPara(r, "agent"); err == nil && agent != "" {
		payload.ReciverAgents = []string{agent}
	}

	if err := sendUserNotification(payload); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// ─── Admin agent configuration ───────────────────────────────────────────────

type telegramConfigView struct {
	//BotTokenSet reports whether a token exists without leaking it. On POST the
	//caller supplies a new token in the "botToken" parameter.
	BotTokenSet bool `json:"botTokenSet"`
}

func handleTelegramConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		view := telegramConfigView{
			BotTokenSet: telegramNotificationAgent != nil && telegramNotificationAgent.IsConfigured(),
		}
		js, _ := json.Marshal(view)
		utils.SendJSONResponse(w, string(js))
		return
	}

	//POST: update the bot token
	botToken, err := utils.PostPara(r, "botToken")
	if err != nil {
		utils.SendErrorResponse(w, "botToken is required")
		return
	}
	botToken = strings.TrimSpace(botToken)

	//Persist to disk (config file only holds the bot token).
	conf := map[string]string{"BotToken": botToken}
	js, _ := json.MarshalIndent(conf, "", " ")
	if err := os.WriteFile(telegramConfigPath, js, 0775); err != nil {
		utils.SendErrorResponse(w, "Unable to save Telegram config: "+err.Error())
		return
	}

	//Apply live so no restart is required.
	if telegramNotificationAgent != nil {
		telegramNotificationAgent.BotToken = botToken
	}
	utils.SendOK(w)
}

// smtpConfigView mirrors the persisted SMTP config with the password masked on
// read.
type smtpConfigView struct {
	SMTPSenderDisplayName string `json:"SMTPSenderDisplayName"`
	SMTPSender            string `json:"SMTPSender"`
	SMTPDomain            string `json:"SMTPDomain"`
	SMTPPort              int    `json:"SMTPPort"`
	PasswordSet           bool   `json:"PasswordSet"`
}

type smtpConfigFile struct {
	SMTPSenderDisplayName string
	SMTPSender            string
	SMTPPassword          string
	SMTPDomain            string
	SMTPPort              int
}

func handleSMTPConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		conf := readSMTPConfig()
		view := smtpConfigView{
			SMTPSenderDisplayName: conf.SMTPSenderDisplayName,
			SMTPSender:            conf.SMTPSender,
			SMTPDomain:            conf.SMTPDomain,
			SMTPPort:              conf.SMTPPort,
			PasswordSet:           conf.SMTPPassword != "",
		}
		js, _ := json.Marshal(view)
		utils.SendJSONResponse(w, string(js))
		return
	}

	//POST: update SMTP config. An empty password keeps the existing one.
	conf := readSMTPConfig()
	if v, err := utils.PostPara(r, "senderDisplayName"); err == nil {
		conf.SMTPSenderDisplayName = v
	}
	if v, err := utils.PostPara(r, "sender"); err == nil {
		conf.SMTPSender = strings.TrimSpace(v)
	}
	if v, err := utils.PostPara(r, "domain"); err == nil {
		conf.SMTPDomain = strings.TrimSpace(v)
	}
	if v, err := utils.PostPara(r, "port"); err == nil {
		if p, convErr := strconv.Atoi(strings.TrimSpace(v)); convErr == nil {
			conf.SMTPPort = p
		}
	}
	if v, err := utils.PostPara(r, "password"); err == nil && strings.TrimSpace(v) != "" {
		conf.SMTPPassword = v
	}

	js, _ := json.MarshalIndent(conf, "", " ")
	if err := os.WriteFile(smtpnConfigPath, js, 0775); err != nil {
		utils.SendErrorResponse(w, "Unable to save SMTP config: "+err.Error())
		return
	}

	//Apply live to the running agent.
	if smtpNotificationAgent != nil {
		smtpNotificationAgent.SMTPSenderDisplayName = conf.SMTPSenderDisplayName
		smtpNotificationAgent.SMTPSender = conf.SMTPSender
		smtpNotificationAgent.SMTPPassword = conf.SMTPPassword
		smtpNotificationAgent.SMTPDomain = conf.SMTPDomain
		smtpNotificationAgent.SMTPPort = conf.SMTPPort
	}
	utils.SendOK(w)
}

// ─── helpers ────────────────────────────────────────────────────────────────

// parsePriority accepts either a numeric or textual priority.
func parsePriority(raw string) int {
	raw = strings.TrimSpace(raw)
	if n, err := strconv.Atoi(raw); err == nil {
		return notification.NormalizePriority(n)
	}
	return notification.PriorityFromString(raw)
}

func readSMTPConfig() smtpConfigFile {
	conf := smtpConfigFile{}
	data, err := os.ReadFile(smtpnConfigPath)
	if err != nil {
		return conf
	}
	json.Unmarshal(data, &conf)
	return conf
}

// smtpConfigured reports whether the SMTP agent has enough config to send mail.
func smtpConfigured() bool {
	conf := readSMTPConfig()
	return conf.SMTPSender != "" && conf.SMTPDomain != "" && conf.SMTPPort != 0
}
