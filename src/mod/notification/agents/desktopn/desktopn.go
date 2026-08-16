package desktopn

/*
	Desktop Notification Agent

	This agent buffers notifications in memory, per user, so the ArozOS web
	desktop (desktop.html) can poll and render them into the notification list,
	the desktop popup and the browser (Chrome) Notification API.

	It holds no external configuration and is always available. Each user has a
	bounded FIFO buffer; when the desktop polls, the pending notifications are
	returned and cleared.
*/

import (
	"sync"

	notification "imuslab.com/arozos/mod/notification"
)

// DefaultMaxBuffered is the maximum number of undelivered notifications kept
// per user. Older notifications are dropped when the buffer is full so a user
// that never opens the desktop cannot grow memory without bound.
const DefaultMaxBuffered = 100

// StoredNotification is the desktop-facing representation of a notification. It
// is the JSON shape returned to the browser when it polls for pending items.
type StoredNotification struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Message   string `json:"message"`
	Sender    string `json:"sender"`
	Priority  string `json:"priority"`
	Timestamp int64  `json:"timestamp"`
	Payload   string `json:"payload"`
}

type Agent struct {
	maxBuffered int
	mu          sync.Mutex
	pending     map[string][]StoredNotification //username -> buffered notifications
}

// NewDesktopNotificationAgent creates a desktop agent with the default buffer
// size.
func NewDesktopNotificationAgent() *Agent {
	return &Agent{
		maxBuffered: DefaultMaxBuffered,
		pending:     map[string][]StoredNotification{},
	}
}

func (a *Agent) Name() string {
	return "desktop"
}

func (a *Agent) Desc() string {
	return "Show notifications on the ArozOS web desktop"
}

func (a *Agent) IsConsumer() bool {
	return true
}

func (a *Agent) IsProducer() bool {
	return false
}

func (a *Agent) ConsumerNotification(incomingNotification *notification.NotificationPayload) error {
	stored := StoredNotification{
		ID:        incomingNotification.ID,
		Title:     incomingNotification.Title,
		Message:   incomingNotification.Message,
		Sender:    incomingNotification.Sender,
		Priority:  notification.PriorityToString(notification.NormalizePriority(incomingNotification.Priority)),
		Timestamp: incomingNotification.Timestamp,
		Payload:   incomingNotification.Payload,
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	for _, username := range incomingNotification.Receiver {
		queue := append(a.pending[username], stored)
		//Enforce the per-user cap by keeping only the newest entries.
		if len(queue) > a.maxBuffered {
			queue = queue[len(queue)-a.maxBuffered:]
		}
		a.pending[username] = queue
	}
	return nil
}

// PollNotifications returns and clears all pending notifications for the given
// user. The desktop calls this on a timer so that each notification is shown
// exactly once.
func (a *Agent) PollNotifications(username string) []StoredNotification {
	a.mu.Lock()
	defer a.mu.Unlock()
	queue := a.pending[username]
	delete(a.pending, username)
	if queue == nil {
		return []StoredNotification{}
	}
	return queue
}

// PeekCount returns the number of pending notifications for a user without
// clearing them. Primarily used for testing and diagnostics.
func (a *Agent) PeekCount(username string) int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.pending[username])
}

// Clear removes any pending notifications for the given user without returning
// them.
func (a *Agent) Clear(username string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.pending, username)
}

func (a *Agent) ProduceNotification(producerListeningEndpoint *notification.AgentProducerFunction) {
	return
}
