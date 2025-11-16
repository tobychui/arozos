package notification

import (
	"errors"
	"testing"
)

// Mock Agent for testing
type MockAgent struct {
	name           string
	desc           string
	isConsumer     bool
	isProducer     bool
	consumedMsgs   []*NotificationPayload
	consumeError   error
	producerFunc   *AgentProducerFunction
}

func (m *MockAgent) Name() string {
	return m.name
}

func (m *MockAgent) Desc() string {
	return m.desc
}

func (m *MockAgent) IsConsumer() bool {
	return m.isConsumer
}

func (m *MockAgent) IsProducer() bool {
	return m.isProducer
}

func (m *MockAgent) ConsumerNotification(payload *NotificationPayload) error {
	m.consumedMsgs = append(m.consumedMsgs, payload)
	return m.consumeError
}

func (m *MockAgent) ProduceNotification(fn *AgentProducerFunction) {
	m.producerFunc = fn
}

func TestNewNotificationQueue(t *testing.T) {
	// Test case 1: Create new queue
	queue := NewNotificationQueue()
	if queue == nil {
		t.Error("Test case 1 failed. Expected non-nil NotificationQueue")
	}

	// Test case 2: Agents list is initialized
	if queue.Agents == nil {
		t.Error("Test case 2 failed. Agents list should not be nil")
	}

	if len(queue.Agents) != 0 {
		t.Errorf("Test case 2 failed. Expected empty Agents list, got %d agents", len(queue.Agents))
	}

	// Test case 3: MasterQueue is initialized
	if queue.MasterQueue == nil {
		t.Error("Test case 3 failed. MasterQueue should not be nil")
	}

	if queue.MasterQueue.Len() != 0 {
		t.Errorf("Test case 3 failed. Expected empty MasterQueue, got %d items", queue.MasterQueue.Len())
	}
}

func TestRegisterNotificationAgent(t *testing.T) {
	queue := NewNotificationQueue()

	// Test case 1: Register single agent
	agent1 := &MockAgent{
		name:       "TestAgent1",
		desc:       "Test Description",
		isConsumer: true,
		isProducer: false,
	}

	queue.RegisterNotificationAgent(agent1)

	if len(queue.Agents) != 1 {
		t.Errorf("Test case 1 failed. Expected 1 agent, got %d", len(queue.Agents))
	}

	// Test case 2: Register multiple agents
	agent2 := &MockAgent{
		name:       "TestAgent2",
		desc:       "Second Agent",
		isConsumer: true,
		isProducer: true,
	}

	queue.RegisterNotificationAgent(agent2)

	if len(queue.Agents) != 2 {
		t.Errorf("Test case 2 failed. Expected 2 agents, got %d", len(queue.Agents))
	}

	// Test case 3: Verify agents are stored correctly
	registeredAgent := *queue.Agents[0]
	if registeredAgent.Name() != "TestAgent1" {
		t.Errorf("Test case 3 failed. Expected agent name 'TestAgent1', got '%s'", registeredAgent.Name())
	}

	// Test case 4: Register multiple agents with same name (should be allowed)
	agent3 := &MockAgent{
		name:       "TestAgent1",
		desc:       "Duplicate Name",
		isConsumer: false,
		isProducer: true,
	}

	queue.RegisterNotificationAgent(agent3)

	if len(queue.Agents) != 3 {
		t.Errorf("Test case 4 failed. Expected 3 agents, got %d", len(queue.Agents))
	}
}

func TestBroadcastNotification_Basic(t *testing.T) {
	queue := NewNotificationQueue()

	// Create a consumer agent
	agent := &MockAgent{
		name:         "ConsumerAgent",
		desc:         "Test Consumer",
		isConsumer:   true,
		consumedMsgs: []*NotificationPayload{},
	}

	queue.RegisterNotificationAgent(agent)

	// Test case 1: Broadcast to enabled agent
	payload := &NotificationPayload{
		ID:            "test-001",
		Title:         "Test Notification",
		Message:       "Test Message",
		Receiver:      []string{"user1", "user2"},
		Sender:        "TestModule",
		ReciverAgents: []string{"ConsumerAgent"},
	}

	err := queue.BroadcastNotification(payload)
	if err != nil {
		t.Errorf("Test case 1 failed. Error: %v", err)
	}

	if len(agent.consumedMsgs) != 1 {
		t.Errorf("Test case 1 failed. Expected 1 consumed message, got %d", len(agent.consumedMsgs))
	}

	if agent.consumedMsgs[0].ID != "test-001" {
		t.Errorf("Test case 1 failed. Expected message ID 'test-001', got '%s'", agent.consumedMsgs[0].ID)
	}
}

func TestBroadcastNotification_AgentFiltering(t *testing.T) {
	queue := NewNotificationQueue()

	// Create multiple agents
	agent1 := &MockAgent{
		name:         "Agent1",
		isConsumer:   true,
		consumedMsgs: []*NotificationPayload{},
	}

	agent2 := &MockAgent{
		name:         "Agent2",
		isConsumer:   true,
		consumedMsgs: []*NotificationPayload{},
	}

	agent3 := &MockAgent{
		name:         "Agent3",
		isConsumer:   true,
		consumedMsgs: []*NotificationPayload{},
	}

	queue.RegisterNotificationAgent(agent1)
	queue.RegisterNotificationAgent(agent2)
	queue.RegisterNotificationAgent(agent3)

	// Test case 1: Only Agent1 and Agent3 should receive
	payload := &NotificationPayload{
		ID:            "test-002",
		Title:         "Selective Notification",
		Message:       "Only for Agent1 and Agent3",
		Receiver:      []string{"user1"},
		Sender:        "TestModule",
		ReciverAgents: []string{"Agent1", "Agent3"},
	}

	err := queue.BroadcastNotification(payload)
	if err != nil {
		t.Errorf("Test case 1 failed. Error: %v", err)
	}

	if len(agent1.consumedMsgs) != 1 {
		t.Errorf("Test case 1 failed. Agent1 should receive 1 message, got %d", len(agent1.consumedMsgs))
	}

	if len(agent2.consumedMsgs) != 0 {
		t.Errorf("Test case 1 failed. Agent2 should receive 0 messages, got %d", len(agent2.consumedMsgs))
	}

	if len(agent3.consumedMsgs) != 1 {
		t.Errorf("Test case 1 failed. Agent3 should receive 1 message, got %d", len(agent3.consumedMsgs))
	}
}

func TestBroadcastNotification_EmptyAgentList(t *testing.T) {
	queue := NewNotificationQueue()

	agent := &MockAgent{
		name:         "TestAgent",
		isConsumer:   true,
		consumedMsgs: []*NotificationPayload{},
	}

	queue.RegisterNotificationAgent(agent)

	// Test case 1: Empty ReciverAgents list
	payload := &NotificationPayload{
		ID:            "test-003",
		Title:         "No Agents",
		Message:       "Should not be delivered",
		Receiver:      []string{"user1"},
		Sender:        "TestModule",
		ReciverAgents: []string{},
	}

	err := queue.BroadcastNotification(payload)
	if err != nil {
		t.Errorf("Test case 1 failed. Error: %v", err)
	}

	if len(agent.consumedMsgs) != 0 {
		t.Errorf("Test case 1 failed. Agent should not receive message, got %d", len(agent.consumedMsgs))
	}
}

func TestBroadcastNotification_AgentError(t *testing.T) {
	queue := NewNotificationQueue()

	// Create agent that returns error
	agent := &MockAgent{
		name:         "ErrorAgent",
		isConsumer:   true,
		consumedMsgs: []*NotificationPayload{},
		consumeError: errors.New("agent error"),
	}

	queue.RegisterNotificationAgent(agent)

	// Test case 1: Agent returns error (should not stop broadcast)
	payload := &NotificationPayload{
		ID:            "test-004",
		Title:         "Error Test",
		Message:       "Test error handling",
		Receiver:      []string{"user1"},
		Sender:        "TestModule",
		ReciverAgents: []string{"ErrorAgent"},
	}

	err := queue.BroadcastNotification(payload)
	// Broadcast should complete successfully even if agent fails
	if err != nil {
		t.Errorf("Test case 1 failed. Broadcast should succeed even with agent error. Got: %v", err)
	}

	// Message should still be attempted to be delivered
	if len(agent.consumedMsgs) != 1 {
		t.Errorf("Test case 1 failed. Message should be attempted despite error, got %d attempts", len(agent.consumedMsgs))
	}
}

func TestBroadcastNotification_MultipleMessages(t *testing.T) {
	queue := NewNotificationQueue()

	agent := &MockAgent{
		name:         "MultiAgent",
		isConsumer:   true,
		consumedMsgs: []*NotificationPayload{},
	}

	queue.RegisterNotificationAgent(agent)

	// Test case 1: Send multiple messages
	for i := 0; i < 5; i++ {
		payload := &NotificationPayload{
			ID:            "test-multi-" + string(rune('0'+i)),
			Title:         "Message " + string(rune('0'+i)),
			Message:       "Test message",
			Receiver:      []string{"user1"},
			Sender:        "TestModule",
			ReciverAgents: []string{"MultiAgent"},
		}

		err := queue.BroadcastNotification(payload)
		if err != nil {
			t.Errorf("Test case 1 failed on message %d. Error: %v", i, err)
		}
	}

	if len(agent.consumedMsgs) != 5 {
		t.Errorf("Test case 1 failed. Expected 5 messages, got %d", len(agent.consumedMsgs))
	}
}

func TestNotificationPayload_Fields(t *testing.T) {
	// Test case 1: Create payload with all fields
	payload := &NotificationPayload{
		ID:            "unique-id-001",
		Title:         "Test Title",
		Message:       "Test Message Body",
		Receiver:      []string{"alice", "bob", "charlie"},
		Sender:        "SystemModule",
		ReciverAgents: []string{"Email", "Push", "SMS"},
	}

	if payload.ID != "unique-id-001" {
		t.Errorf("Test case 1 failed. ID mismatch")
	}

	if len(payload.Receiver) != 3 {
		t.Errorf("Test case 1 failed. Expected 3 receivers, got %d", len(payload.Receiver))
	}

	if len(payload.ReciverAgents) != 3 {
		t.Errorf("Test case 1 failed. Expected 3 receiver agents, got %d", len(payload.ReciverAgents))
	}

	// Test case 2: Empty payload
	emptyPayload := &NotificationPayload{}
	if emptyPayload.ID != "" {
		t.Error("Test case 2 failed. Empty payload should have empty ID")
	}

	// Test case 3: Payload with single receiver
	singlePayload := &NotificationPayload{
		Receiver:      []string{"single-user"},
		ReciverAgents: []string{"single-agent"},
	}

	if len(singlePayload.Receiver) != 1 {
		t.Errorf("Test case 3 failed. Expected 1 receiver, got %d", len(singlePayload.Receiver))
	}
}

func TestBroadcastNotification_NoAgents(t *testing.T) {
	queue := NewNotificationQueue()

	// Test case 1: Broadcast with no registered agents
	payload := &NotificationPayload{
		ID:            "test-no-agents",
		Title:         "No Agents Test",
		Message:       "Testing empty agent list",
		Receiver:      []string{"user1"},
		Sender:        "TestModule",
		ReciverAgents: []string{"NonExistentAgent"},
	}

	err := queue.BroadcastNotification(payload)
	if err != nil {
		t.Errorf("Test case 1 failed. Should handle empty agents gracefully. Error: %v", err)
	}
}
