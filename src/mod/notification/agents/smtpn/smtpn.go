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
	"mime"
	"net/smtp"
	"os"
	"strconv"
	"strings"
	"time"

	"imuslab.com/arozos/mod/info/logger"
	notification "imuslab.com/arozos/mod/notification"
	"imuslab.com/arozos/mod/utils"
)

// logoAssetPath is the ArozOS brand icon attached inline (as a CID resource) in
// the email footer so it renders in every mail client, including Gmail, without
// fetching a remote resource.
const logoAssetPath = "./web/img/public/pwa/192.png"

// logoContentID is the Content-ID the HTML template references via cid:.
const logoContentID = "arozoslogo"

// loadLogoBytes reads the raw brand icon bytes, or nil when the asset cannot be
// read (e.g. outside the app root, as in unit tests).
func loadLogoBytes() []byte {
	data, err := os.ReadFile(logoAssetPath)
	if err != nil {
		return nil
	}
	return data
}

// wrapBase64 splits a base64 string into 76-character lines as required by
// RFC 2045 for the base64 content transfer encoding.
func wrapBase64(s string) string {
	const width = 76
	var b strings.Builder
	for len(s) > width {
		b.WriteString(s[:width])
		b.WriteString("\r\n")
		s = s[width:]
	}
	b.WriteString(s)
	return b.String()
}

// buildEmailMessage assembles the raw RFC 5322 / MIME message. When logo bytes
// are provided the message is multipart/related with the icon attached inline
// (referenced by the template as cid:arozoslogo); otherwise it is a plain
// text/html message.
func buildEmailMessage(from, to, subject, htmlBody string, logo []byte) []byte {
	var b strings.Builder
	b.WriteString("To: " + to + "\r\n")
	b.WriteString("From: " + from + "\r\n")
	b.WriteString("Subject: " + mime.QEncoding.Encode("UTF-8", subject) + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")

	htmlPartBody := wrapBase64(base64.StdEncoding.EncodeToString([]byte(htmlBody)))

	if len(logo) == 0 {
		b.WriteString("Content-Type: text/html; charset=\"UTF-8\"\r\n")
		b.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
		b.WriteString(htmlPartBody)
		return []byte(b.String())
	}

	boundary := fmt.Sprintf("arozos_%d", time.Now().UnixNano())
	b.WriteString("Content-Type: multipart/related; type=\"text/html\"; boundary=\"" + boundary + "\"\r\n\r\n")

	//HTML part
	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/html; charset=\"UTF-8\"\r\n")
	b.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
	b.WriteString(htmlPartBody + "\r\n")

	//Inline image part (cid:arozoslogo)
	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: image/png\r\n")
	b.WriteString("Content-Transfer-Encoding: base64\r\n")
	b.WriteString("Content-ID: <" + logoContentID + ">\r\n")
	b.WriteString("Content-Disposition: inline; filename=\"arozos.png\"\r\n\r\n")
	b.WriteString(wrapBase64(base64.StdEncoding.EncodeToString(logo)) + "\r\n")

	b.WriteString("--" + boundary + "--\r\n")
	return []byte(b.String())
}

type Agent struct {
	Hostname              string        `json:"-"`
	SystemUUIDProvider    func() string `json:"-"` //Returns the host System UUID for the email footer (optional)
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

		//Resolve the host System UUID for the footer (identifies the sending host)
		systemUUID := ""
		if a.SystemUUIDProvider != nil {
			systemUUID = a.SystemUUIDProvider()
		}
		if systemUUID == "" {
			systemUUID = "unknown"
		}

		//Load email template
		s, err := utils.Templateload("./system/www/smtpn.html", map[string]string{
			"receiver":  "Hello " + thisUser + ",",
			"message":   incomingNotification.Message,
			"sender":    incomingNotification.Sender,
			"hostname":  a.Hostname,
			"uuid":      systemUUID,
			"id":        incomingNotification.ID,
			"timestamp": time.Now().Format("2006-01-02 3:04:05 PM"),
		})
		if err != nil {
			logger.PrintAndLog("Smtpn", "[SMTP] Template load failed: "+err.Error(), nil)
		}

		from := a.SMTPSenderDisplayName + " <" + a.SMTPSender + ">"
		msg := buildEmailMessage(from, thisEmail, buildSubject(incomingNotification), s, loadLogoBytes())

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

// buildSubject prefixes the notification title with its priority (e.g.
// "[High] Disk failing") when a priority is set on the payload.
func buildSubject(n *notification.NotificationPayload) string {
	if n.Priority <= 0 {
		//No priority set on the payload; use the title as-is.
		return n.Title
	}
	label := notification.PriorityToString(notification.NormalizePriority(n.Priority))
	if label == "" {
		return n.Title
	}
	//Capitalise the first letter: "high" -> "High".
	label = strings.ToUpper(label[:1]) + label[1:]
	return "[" + label + "] " + n.Title
}

func (a Agent) ProduceNotification(producerListeningEndpoint *notification.AgentProducerFunction) {
	return
}
