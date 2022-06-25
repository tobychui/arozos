package notification

import (
	"container/list"
	"log"
)

/*
	Notification Producer and Consumer Queue

	This module is designed to route the notification from module that produce it
	to all the devices or agent that can reach the user
*/

type NotificationPayload struct {
	ID            string   //Notification ID, generate by producer
	Title         string   //Title of the notification
	Message       string   //Message of the notification
	Receiver      []string //Receiver, username in arozos system
	Sender        string   //Sender, the sender or module of the notification
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

//Add a notification agent to the queue
func (q *NotificationQueue) RegisterNotificationAgent(agent Agent) {
	q.Agents = append(q.Agents, &agent)
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
			log.Println("[Notification] Unable to send message via notification agent: " + thisAgent.Name())
		}

	}

	log.Println("[Notification] Message titled: " + message.Title + " (ID: " + message.ID + ") broadcasted")
	return nil
}
