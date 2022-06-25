package main

import (
	"log"
	"strconv"
	"time"

	fs "imuslab.com/arozos/mod/filesystem"
	notification "imuslab.com/arozos/mod/notification"
	"imuslab.com/arozos/mod/notification/agents/smtpn"
)

var notificationQueue *notification.NotificationQueue

func notificationInit() {
	//Create a new notification agent
	notificationQueue = notification.NewNotificationQueue()

	//Register the notification agents

	/*
		SMTP Notification Agent
		For handling notification sending via Mail
	*/

	//Load username and their email from authAgent
	userEmailmap := map[string]string{}
	allRecords := registerHandler.ListAllUserEmails()
	for _, userRercord := range allRecords {
		if userRercord[2].(bool) {
			userEmailmap[userRercord[0].(string)] = userRercord[1].(string)
		}
	}

	smtpnConfigPath := "./system/smtp_conf.json"
	if !fs.FileExists(smtpnConfigPath) {
		//Create an empty one
		smtpn.GenerateEmptyConfigFile(smtpnConfigPath)
	}

	smtpAgent, err := smtpn.NewSMTPNotificationAgent(*host_name, smtpnConfigPath,
		func(username string) (string, error) {
			//Translate username to email
			return registerHandler.GetUserEmail(username)
		})

	if err != nil {
		log.Println("[Notification/SMTPN] Unable to start smtpn agent: " + err.Error())
	} else {
		notificationQueue.RegisterNotificationAgent(smtpAgent)
	}

	//Create and register other notification agents

	go func() {
		time.Sleep(10 * time.Second)
		return
		notificationQueue.BroadcastNotification(&notification.NotificationPayload{
			ID:            strconv.Itoa(int(time.Now().Unix())),
			Title:         "Email Test",
			Message:       "This is a testing notification for showcasing a sample email when DISK SMART error was scanned and discovered.<br> Please visit <a href='https://blog.teacat.io'>here</a> for more information.",
			Receiver:      []string{"TC"},
			Sender:        "SMART Nightly Scanner",
			ReciverAgents: []string{"smtpn"},
		})
	}()

}
