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

	"imuslab.com/arozos/mod/info/logger"
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
	logger.DebugTrace("notification/agents/desktopn", "NewDesktopNotificationAgent")
	return &Agent{
		maxBuffered: DefaultMaxBuffered,
		pending:     map[string][]StoredNotification{},
	}
}

func (a *Agent) Name() string {
	logger.DebugTrace("notification/agents/desktopn", "Agent.Name")
	return "desktop"
}

func (a *Agent) Desc() string {
	logger.DebugTrace("notification/agents/desktopn", "Agent.Desc")
	return "Show notifications on the ArozOS web desktop"
}

func (a *Agent) IsConsumer() bool {
	logger.DebugTrace("notification/agents/desktopn", "Agent.IsConsumer")
	return true
}

func (a *Agent) IsProducer() bool {
	logger.DebugTrace("notification/agents/desktopn", "Agent.IsProducer")
	return false
}

func (a *Agent) ConsumerNotification(incomingNotification *notification.NotificationPayload) error {
	logger.Debug("notification/agents/desktopn", "Agent.ConsumerNotification")
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
	if logger.IsDebug() {
		logger.Debugf("notification/agents/desktopn", "Agent.PollNotifications: username=%.120q", username)
	}
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
	if logger.IsDebug() {
		logger.Debugf("notification/agents/desktopn", "Agent.PeekCount: username=%.120q", username)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.pending[username])
}

// Clear removes any pending notifications for the given user without returning
// them.
func (a *Agent) Clear(username string) {
	if logger.IsDebug() {
		logger.Debugf("notification/agents/desktopn", "Agent.Clear: username=%.120q", username)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.pending, username)
}

func (a *Agent) ProduceNotification(producerListeningEndpoint *notification.AgentProducerFunction) {
	logger.DebugTrace("notification/agents/desktopn", "Agent.ProduceNotification")
	return
}
