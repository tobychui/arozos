package smtpn

/*

	SMTP Notifaiction Agent

	This is the mail sending agent for sending notification to user

*/

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/smtp"
	"os"
	"strconv"
	"time"

	"imuslab.com/arozos/mod/info/logger"
	notification "imuslab.com/arozos/mod/notification"
	"imuslab.com/arozos/mod/utils"
)

// logoAssetPath is the ArozOS brand icon embedded (as a data URI) in the email
// footer so it renders without the mail client fetching a remote resource.
const logoAssetPath = "./web/img/public/pwa/192.png"

// loadLogoDataURI reads the brand icon and returns it as a base64 data URI, or
// an empty string when the asset cannot be read (e.g. outside the app root).
func loadLogoDataURI() string {
	data, err := os.ReadFile(logoAssetPath)
	if err != nil {
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)
}

type Agent struct {
	Hostname              string `json:"-"`
	SystemVersion         string `json:"-"` //Host version string shown in the email footer (optional)
	SMTPSenderDisplayName string
	SMTPSender            string
	SMTPPassword          string
	SMTPDomain            string
	SMTPPort              int
	UsernameToEmail       func(string) (string, error) `json:"-"`
}

func NewSMTPNotificationAgent(hostname string, configFile string, usernameToEmailFunction func(string) (string, error)) (*Agent, error) {
	config, err := os.ReadFile(configFile)

	if err != nil {
		return nil, errors.New("Unable to load config from file: " + err.Error())
	}

	//Pasre the json file to agent object
	newAgent := Agent{}
	err = json.Unmarshal(config, &newAgent)
	if err != nil {
		return nil, errors.New("Unable to parse config file for SMTP authentication")
	}

	newAgent.Hostname = hostname
	newAgent.UsernameToEmail = usernameToEmailFunction
	return &newAgent, nil

}

// Generate an empty config filepath
func GenerateEmptyConfigFile(configFilepath string) error {
	demoConfig := Agent{}
	//Stringify the empty struct
	js, err := json.MarshalIndent(demoConfig, "", " ")
	if err != nil {
		return err
	}

	//Write to file
	err = os.WriteFile(configFilepath, js, 0775)
	return err

}

func (a Agent) Name() string {
	return "smtpn"
}

func (a Agent) Desc() string {
	return "Notify user throught email"
}

func (a Agent) IsConsumer() bool {
	return true
}

func (a Agent) IsProducer() bool {
	return false
}

func (a Agent) ConsumerNotification(incomingNotification *notification.NotificationPayload) error {
	//Get a notification and send it out

	//Analysis the notification, get the target user's email
	userEmails := [][]string{}

	for _, username := range incomingNotification.Receiver {

		userEmail, err := a.UsernameToEmail(username)
		if err == nil {
			userEmails = append(userEmails, []string{username, userEmail})
		} else {
			logger.PrintAndLog("Smtpn", "[SMTP Notification] Unable to notify "+username+": Email not set", nil)
		}
	}

	//For each user, send out the email
	for _, thisEntry := range userEmails {
		thisUser := thisEntry[0]
		thisEmail := thisEntry[1]

		//Load email template
		systemVersion := a.SystemVersion
		if systemVersion == "" {
			systemVersion = "unknown"
		}
		s, err := utils.Templateload("./system/www/smtpn.html", map[string]string{
			"receiver":  "Hello " + thisUser + ",",
			"message":   incomingNotification.Message,
			"sender":    incomingNotification.Sender,
			"hostname":  a.Hostname,
			"version":   systemVersion,
			"logo":      loadLogoDataURI(),
			"timestamp": time.Now().Format("2006-01-02 3:4:5 PM"),
		})
		if err != nil {
			logger.PrintAndLog("Smtpn", "[SMTP] Template load failed: "+err.Error(), nil)
		}

		msg := []byte("To: " + thisEmail + "\n" +
			"From: " + a.SMTPSenderDisplayName + " <" + a.SMTPSender + ">\n" +
			"Subject: " + incomingNotification.Title + "\n" +
			"MIME-version: 1.0;\nContent-Type: text/html; charset=\"UTF-8\";\n\n" +
			s + "\n\n")

		//Login to the SMTP server
		auth := smtp.PlainAuth("", a.SMTPSender, a.SMTPPassword, a.SMTPDomain)
		err = smtp.SendMail(a.SMTPDomain+":"+strconv.Itoa(a.SMTPPort), auth, a.SMTPSender, []string{thisEmail}, msg)
		if err != nil {
			logger.PrintAndLog("Smtpn", fmt.Sprint("[SMTPN] Email sent failed: ", err.Error()), nil)
			return err
		}
	}

	return nil
}

func (a Agent) ProduceNotification(producerListeningEndpoint *notification.AgentProducerFunction) {
	return
}
