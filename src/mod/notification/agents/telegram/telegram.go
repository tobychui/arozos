package telegram

/*
	Telegram Notification Agent

	This agent delivers ArozOS notifications to users via a Telegram bot.
	The bot token is a system-wide (admin configured) secret while each user
	links their own Telegram chat by storing a chat id in their per-user
	notification preferences (resolved through UsernameToChatID).
*/

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"imuslab.com/arozos/mod/info/logger"
	notification "imuslab.com/arozos/mod/notification"
)

// DefaultAPIEndpoint is the base URL of the Telegram Bot API. It is overridable
// on the Agent struct so unit tests can point it at a local test server.
const DefaultAPIEndpoint = "https://api.telegram.org"

type config struct {
	BotToken string
}

type Agent struct {
	BotToken string       `json:"-"` //Telegram bot token (admin secret), loaded from config file
	Endpoint string       `json:"-"` //Base API endpoint, defaults to DefaultAPIEndpoint
	Client   *http.Client `json:"-"` //HTTP client used to reach Telegram

	//UsernameToChatID resolves an ArozOS username into that user's linked
	//Telegram chat id. Returns an error when the user has not linked a chat.
	UsernameToChatID func(string) (string, error) `json:"-"`
}

// NewTelegramNotificationAgent constructs a Telegram agent from the given
// config file. The config file only holds the bot token; per-user chat ids are
// resolved via the provided chatIDResolver.
func NewTelegramNotificationAgent(configFile string, chatIDResolver func(string) (string, error)) (*Agent, error) {
	content, err := os.ReadFile(configFile)
	if err != nil {
		return nil, errors.New("Unable to load config from file: " + err.Error())
	}

	thisConfig := config{}
	err = json.Unmarshal(content, &thisConfig)
	if err != nil {
		return nil, errors.New("Unable to parse config file for Telegram notification agent")
	}

	return &Agent{
		BotToken:         thisConfig.BotToken,
		Endpoint:         DefaultAPIEndpoint,
		Client:           &http.Client{Timeout: 10 * time.Second},
		UsernameToChatID: chatIDResolver,
	}, nil
}

// GenerateEmptyConfigFile writes an empty Telegram config file (no bot token)
// to the given path so the admin can fill it in later.
func GenerateEmptyConfigFile(configFilepath string) error {
	js, err := json.MarshalIndent(config{}, "", " ")
	if err != nil {
		return err
	}
	return os.WriteFile(configFilepath, js, 0775)
}

func (a *Agent) Name() string {
	return "telegram"
}

func (a *Agent) Desc() string {
	return "Notify user through a Telegram bot"
}

func (a *Agent) IsConsumer() bool {
	return true
}

func (a *Agent) IsProducer() bool {
	return false
}

// IsConfigured reports whether the agent has a bot token set. When it is not
// configured, delivery is skipped instead of erroring per user.
func (a *Agent) IsConfigured() bool {
	return strings.TrimSpace(a.BotToken) != ""
}

// FormatMessage renders the notification into the plain text body sent to
// Telegram, prefixing the priority so users can triage at a glance.
func FormatMessage(payload *notification.NotificationPayload) string {
	priorityTag := strings.ToUpper(notification.PriorityToString(notification.NormalizePriority(payload.Priority)))
	sender := payload.Sender
	if sender == "" {
		sender = "ArozOS"
	}
	return fmt.Sprintf("[%s] %s\n%s\n\n- %s", priorityTag, payload.Title, payload.Message, sender)
}

func (a *Agent) ConsumerNotification(incomingNotification *notification.NotificationPayload) error {
	if !a.IsConfigured() {
		return errors.New("Telegram agent is not configured (missing bot token)")
	}
	if a.UsernameToChatID == nil {
		return errors.New("Telegram agent has no chat id resolver")
	}

	messageBody := FormatMessage(incomingNotification)

	var lastErr error
	for _, username := range incomingNotification.Receiver {
		chatID, err := a.UsernameToChatID(username)
		if err != nil || strings.TrimSpace(chatID) == "" {
			logger.PrintAndLog("Telegram", "[Telegram Notification] Unable to notify "+username+": no linked Telegram chat", nil)
			continue
		}

		err = a.sendMessage(chatID, messageBody)
		if err != nil {
			logger.PrintAndLog("Telegram", "[Telegram Notification] Failed to send message to "+username+": "+err.Error(), nil)
			lastErr = err
		}
	}

	return lastErr
}

// sendMessage delivers a single text message to the given chat id via the
// Telegram Bot API sendMessage method.
func (a *Agent) sendMessage(chatID string, message string) error {
	endpoint := a.Endpoint
	if endpoint == "" {
		endpoint = DefaultAPIEndpoint
	}
	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}

	apiURL := strings.TrimRight(endpoint, "/") + "/bot" + a.BotToken + "/sendMessage"
	form := url.Values{}
	form.Set("chat_id", chatID)
	form.Set("text", message)

	resp, err := client.PostForm(apiURL, form)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Telegram API returned status %d", resp.StatusCode)
	}
	return nil
}

func (a *Agent) ProduceNotification(producerListeningEndpoint *notification.AgentProducerFunction) {
	return
}
