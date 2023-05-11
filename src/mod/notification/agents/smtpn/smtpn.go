package smtpn

/*

	SMTP Notifaiction Agent

	This is the mail sending agent for sending notification to user

*/

import (
	"encoding/json"
	"errors"
	"log"
	"net/smtp"
	"os"
	"strconv"
	"time"

	"github.com/valyala/fasttemplate"
	notification "imuslab.com/arozos/mod/notification"
)

type Agent struct {
	Hostname              string `json:"-"`
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
			log.Println("[SMTP Notification] Unable to notify " + username + ": Email not set")
		}
	}

	//For each user, send out the email
	for _, thisEntry := range userEmails {
		thisUser := thisEntry[0]
		thisEmail := thisEntry[1]

		//Load email template
		template, _ := os.ReadFile("system/www/smtpn.html")
		t := fasttemplate.New(string(template), "{{", "}}")
		s := t.ExecuteString(map[string]interface{}{
			"receiver":  "Hello " + thisUser + ",",
			"message":   incomingNotification.Message,
			"sender":    incomingNotification.Sender,
			"hostname":  a.Hostname,
			"timestamp": time.Now().Format("2006-01-02 3:4:5 PM"),
		})

		msg := []byte("To: " + thisEmail + "\n" +
			"From: " + a.SMTPSenderDisplayName + " <" + a.SMTPSender + ">\n" +
			"Subject: " + incomingNotification.Title + "\n" +
			"MIME-version: 1.0;\nContent-Type: text/html; charset=\"UTF-8\";\n\n" +
			s + "\n\n")

		//Login to the SMTP server
		auth := smtp.PlainAuth("", a.SMTPSender, a.SMTPPassword, a.SMTPDomain)
		err := smtp.SendMail(a.SMTPDomain+":"+strconv.Itoa(a.SMTPPort), auth, a.SMTPSender, []string{thisEmail}, msg)
		if err != nil {
			log.Println("[SMTPN] Email sent failed: ", err.Error())
			return err
		}
	}

	return nil
}

func (a Agent) ProduceNotification(producerListeningEndpoint *notification.AgentProducerFunction) {
	return
}
