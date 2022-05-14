package main

import "container/list"

/*
	Notification Producer and Consumer Queue

	This module is designed to route the notification from module that produce it
	to all the devices or agent that can reach the user
*/

type NotificationPayload struct {
	ID        string   //Notification ID, generate by producer
	Title     string   //Title of the notification
	Message   string   //Message of the notification
	Receiver  []string //Receiver, username in arozos system
	Sender    string   //Sender, the sender or module of the notification
	ActionURL string   //URL for futher action or open related pages (as url), leave empty if not appliable
	IsUrgent  bool     //Label this notification as urgent
}

//Notification Consumer, object that use to consume notification from queue
type Consumer struct {
	Name string
	Desc string

	ListenTopicMode int
	Notify          func(*NotificationPayload) error
	ListeningQueue  *NotificationQueue
}

//Notification Producer, object that use to create and push notification into the queue
type Producer struct {
	Name string
	Desc string

	PushTopicType int
	TargetQueue   *NotificationQueue
}

type NotificationQueue struct {
	Producers []*Producer
	Consumers []*Consumer

	MasterQueue *list.List
}

func NewNotificationQueue() *NotificationQueue {
	thisQueue := list.New()

	return &NotificationQueue{
		Producers:   []*Producer{},
		Consumers:   []*Consumer{},
		MasterQueue: thisQueue,
	}
}

//Add a notification producer into the master queue
func (n *NotificationQueue) AddNotificationProducer(p *Producer) {
	n.Producers = append(n.Producers, p)
}

//Add a notification consumer into the master queue
func (n *NotificationQueue) AddNotificationConsumer(c *Consumer) {
	n.Consumers = append(n.Consumers, c)
}

//Push a notifiation to all consumers with same topic type
func (n *NotificationQueue) PushNotification(TopicType int, message *NotificationPayload) {

}
