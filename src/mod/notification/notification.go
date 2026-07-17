package notification

import (
	"container/list"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

/*
	Notification Producer and Consumer Queue

	This module is designed to route the notification from module that produce it
	to all the devices or agent that can reach the user
*/

// Notification priority levels. A producer tags each notification with one of
// these so that users can decide, per delivery channel, the minimum priority
// they wish to receive.
const (
	PriorityLow    = 1
	PriorityMedium = 2
	PriorityHigh   = 3
)

type NotificationPayload struct {
	ID            string   //Notification ID, generate by producer
	Title         string   //Title of the notification
	Message       string   //Message of the notification
	Receiver      []string //Receiver, username in arozos system
	Sender        string   //Sender, the sender or module of the notification
	Priority      int      //Priority of the notification, see Priority* constants (0 = unset, treated as medium)
	Timestamp     int64    //Unix timestamp (seconds) when the notification was produced
	Payload       string   //Optional payload, e.g. a JSON window-open option used by the desktop agent for click redirection
	ReciverAgents []string //Agent name that have access to this notification
}

type AgentProducerFunction func(*NotificationPayload) error

type Agent interface {
	//Defination of the agent
	Name() string                                    //The name of the notification agent, must be unique
	Desc() string                                    //Basic description of the agent
	IsConsumer() bool                                //Can receive notification can arozos core
	IsProducer() bool                                //Can produce notification to arozos core
	ConsumerNotification(*NotificationPayload) error //Endpoint for arozos -> this agent
	ProduceNotification(*AgentProducerFunction)      //Endpoint for this agent -> arozos
}

// Sender is implemented by anything (e.g. the ArozOS core notification router)
// that can accept a notification for delivery. Injected into subsystems like
// the AGI gateway so scripts can raise notifications without importing the
// concrete queue implementation.
type Sender interface {
	SendNotification(*NotificationPayload) error
}

type NotificationQueue struct {
	Agents      []*Agent
	MasterQueue *list.List
}

func NewNotificationQueue() *NotificationQueue {
	thisQueue := list.New()

	return &NotificationQueue{
		Agents:      []*Agent{},
		MasterQueue: thisQueue,
	}
}

// Add a notification agent to the queue
func (q *NotificationQueue) RegisterNotificationAgent(agent Agent) {
	q.Agents = append(q.Agents, &agent)
}

// GetAgentByName returns the registered agent with the given name, or nil if
// no such agent is registered.
func (q *NotificationQueue) GetAgentByName(name string) Agent {
	for _, agent := range q.Agents {
		if (*agent).Name() == name {
			return *agent
		}
	}
	return nil
}

// ListConsumerAgentNames returns the names of all registered agents that can
// consume (deliver) notifications.
func (q *NotificationQueue) ListConsumerAgentNames() []string {
	names := []string{}
	for _, agent := range q.Agents {
		if (*agent).IsConsumer() {
			names = append(names, (*agent).Name())
		}
	}
	return names
}

func (q *NotificationQueue) BroadcastNotification(message *NotificationPayload) error {
	//Send notification to consumer agents
	for _, agent := range q.Agents {
		thisAgent := *agent
		inAgentList := false
		for _, enabledAgent := range message.ReciverAgents {
			if enabledAgent == thisAgent.Name() {
				//This agent is activated
				inAgentList = true
				break
			}
		}

		if !inAgentList {
			//Skip this agent and continue
			continue
		}

		//Send this notification via this agent
		err := thisAgent.ConsumerNotification(message)
		if err != nil {
			logger.PrintAndLog("Notification", "[Notification] Unable to send message via notification agent: "+thisAgent.Name(), nil)
		}

	}

	logger.PrintAndLog("Notification", "[Notification] Message titled: "+message.Title+" (ID: "+message.ID+") broadcasted", nil)
	return nil
}

// PriorityFromString converts a human readable priority string (low / medium /
// high, case-insensitive) into one of the Priority* constants. Any unknown
// value falls back to PriorityMedium.
func PriorityFromString(priority string) int {
	switch strings.ToLower(strings.TrimSpace(priority)) {
	case "low":
		return PriorityLow
	case "medium", "med", "normal":
		return PriorityMedium
	case "high", "urgent":
		return PriorityHigh
	default:
		return PriorityMedium
	}
}

// PriorityToString converts a Priority* constant back into its human readable
// form. Any unknown value is reported as "medium".
func PriorityToString(priority int) string {
	switch priority {
	case PriorityLow:
		return "low"
	case PriorityHigh:
		return "high"
	default:
		return "medium"
	}
}

// NormalizePriority clamps an arbitrary integer into a valid Priority* value,
// treating the zero value (unset) as PriorityMedium.
func NormalizePriority(priority int) int {
	if priority < PriorityLow {
		return PriorityMedium
	}
	if priority > PriorityHigh {
		return PriorityHigh
	}
	return priority
}
