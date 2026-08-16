package webhookn

/*
	Custom HTML API (Webhook) Notification Agent

	This agent delivers a notification to a per-user configurable HTTP endpoint
	("custom HTML API"). Each user supplies their own target URL, HTTP method
	and an optional body template with placeholders. This lets users bridge
	ArozOS notifications into any external service that accepts a webhook.

	Supported placeholders in the body / query template:
		{{id}} {{title}} {{message}} {{sender}} {{priority}} {{timestamp}}
*/

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"imuslab.com/arozos/mod/info/logger"
	notification "imuslab.com/arozos/mod/notification"
)

// Target describes one user's webhook configuration.
type Target struct {
	URL          string `json:"url"`          //Destination URL (http/https)
	Method       string `json:"method"`       //HTTP method, GET or POST (default POST)
	ContentType  string `json:"contentType"`  //Content-Type header for POST (default application/json)
	BodyTemplate string `json:"bodyTemplate"` //Optional body template; empty means a default JSON body
}

type Agent struct {
	Client *http.Client `json:"-"`

	//UsernameToTarget resolves an ArozOS username into that user's configured
	//webhook target. Returns an error when the user has not configured one.
	UsernameToTarget func(string) (Target, error) `json:"-"`
}

// NewWebhookNotificationAgent constructs a webhook agent using the given
// per-user target resolver.
func NewWebhookNotificationAgent(targetResolver func(string) (Target, error)) *Agent {
	return &Agent{
		Client:           &http.Client{Timeout: 10 * time.Second},
		UsernameToTarget: targetResolver,
	}
}

func (a *Agent) Name() string {
	return "webhook"
}

func (a *Agent) Desc() string {
	return "Notify user through a custom HTTP webhook (custom HTML API)"
}

func (a *Agent) IsConsumer() bool {
	return true
}

func (a *Agent) IsProducer() bool {
	return false
}

// defaultJSONBody is used when the user has not supplied a body template.
const defaultJSONBody = `{"id":"{{id}}","title":"{{title}}","message":"{{message}}","sender":"{{sender}}","priority":"{{priority}}","timestamp":"{{timestamp}}"}`

// RenderTemplate substitutes the notification placeholders in the given
// template. Values are JSON-string-escaped so that the default JSON body stays
// valid even when titles or messages contain quotes or backslashes.
func RenderTemplate(template string, payload *notification.NotificationPayload) string {
	priority := notification.PriorityToString(notification.NormalizePriority(payload.Priority))
	replacer := strings.NewReplacer(
		"{{id}}", jsonEscape(payload.ID),
		"{{title}}", jsonEscape(payload.Title),
		"{{message}}", jsonEscape(payload.Message),
		"{{sender}}", jsonEscape(payload.Sender),
		"{{priority}}", priority,
		"{{timestamp}}", strconv.FormatInt(payload.Timestamp, 10),
	)
	return replacer.Replace(template)
}

// jsonEscape escapes the minimal set of characters required to keep a value
// safe inside a JSON string literal without pulling in a full JSON encode.
func jsonEscape(in string) string {
	replacer := strings.NewReplacer(
		"\\", "\\\\",
		"\"", "\\\"",
		"\n", "\\n",
		"\r", "\\r",
		"\t", "\\t",
	)
	return replacer.Replace(in)
}

// ValidateTarget checks that a webhook target has a usable http/https URL.
func ValidateTarget(target Target) error {
	u, err := url.Parse(strings.TrimSpace(target.URL))
	if err != nil {
		return errors.New("invalid webhook URL: " + err.Error())
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return errors.New("webhook URL must use http or https scheme")
	}
	if u.Host == "" {
		return errors.New("webhook URL is missing a host")
	}
	return nil
}

func (a *Agent) ConsumerNotification(incomingNotification *notification.NotificationPayload) error {
	if a.UsernameToTarget == nil {
		return errors.New("Webhook agent has no target resolver")
	}

	var lastErr error
	for _, username := range incomingNotification.Receiver {
		target, err := a.UsernameToTarget(username)
		if err != nil || strings.TrimSpace(target.URL) == "" {
			logger.PrintAndLog("Webhook", "[Webhook Notification] Unable to notify "+username+": no webhook configured", nil)
			continue
		}

		if err := a.deliver(target, incomingNotification); err != nil {
			logger.PrintAndLog("Webhook", "[Webhook Notification] Failed to notify "+username+": "+err.Error(), nil)
			lastErr = err
		}
	}
	return lastErr
}

// deliver performs a single webhook HTTP request for the given target.
func (a *Agent) deliver(target Target, payload *notification.NotificationPayload) error {
	if err := ValidateTarget(target); err != nil {
		return err
	}

	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}

	method := strings.ToUpper(strings.TrimSpace(target.Method))
	if method == "" {
		method = http.MethodPost
	}

	if method == http.MethodGet {
		//Append notification fields as query parameters.
		u, _ := url.Parse(target.URL)
		q := u.Query()
		q.Set("id", payload.ID)
		q.Set("title", payload.Title)
		q.Set("message", payload.Message)
		q.Set("sender", payload.Sender)
		q.Set("priority", notification.PriorityToString(notification.NormalizePriority(payload.Priority)))
		q.Set("timestamp", strconv.FormatInt(payload.Timestamp, 10))
		u.RawQuery = q.Encode()

		resp, err := client.Get(u.String())
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		return checkStatus(resp.StatusCode)
	}

	//POST (default): render the body template.
	bodyTemplate := target.BodyTemplate
	if strings.TrimSpace(bodyTemplate) == "" {
		bodyTemplate = defaultJSONBody
	}
	contentType := target.ContentType
	if strings.TrimSpace(contentType) == "" {
		contentType = "application/json"
	}
	body := RenderTemplate(bodyTemplate, payload)

	req, err := http.NewRequest(http.MethodPost, target.URL, strings.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return checkStatus(resp.StatusCode)
}

// checkStatus treats any 2xx response as success.
func checkStatus(status int) error {
	if status >= 200 && status < 300 {
		return nil
	}
	return errors.New("webhook endpoint returned status " + strconv.Itoa(status))
}

func (a *Agent) ProduceNotification(producerListeningEndpoint *notification.AgentProducerFunction) {
	return
}
