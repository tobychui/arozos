package notification

import (
	"errors"
	"testing"
)

// mockAgent is a minimal implementation of the Agent interface used in tests.
type mockAgent struct {
	name         string
	isConsumer   bool
	isProducer   bool
	receivedMsgs []*NotificationPayload
	returnErr    error
}

func (m *mockAgent) Name() string     { return m.name }
func (m *mockAgent) Desc() string     { return "mock agent" }
func (m *mockAgent) IsConsumer() bool { return m.isConsumer }
func (m *mockAgent) IsProducer() bool { return m.isProducer }

func (m *mockAgent) ConsumerNotification(p *NotificationPayload) error {
	if m.returnErr != nil {
		return m.returnErr
	}
	m.receivedMsgs = append(m.receivedMsgs, p)
	return nil
}

func (m *mockAgent) ProduceNotification(fn *AgentProducerFunction) {}

// TestNewNotificationQueue verifies that NewNotificationQueue returns a valid,
// empty queue.
func TestNewNotificationQueue(t *testing.T) {
	q := NewNotificationQueue()
	if q == nil {
		t.Fatal("expected non-nil NotificationQueue")
	}
	if q.MasterQueue == nil {
		t.Error("expected MasterQueue to be initialised")
	}
	if len(q.Agents) != 0 {
		t.Errorf("expected 0 agents, got %d", len(q.Agents))
	}
}

// TestRegisterNotificationAgent verifies that an agent is appended to the
// queue's Agents slice after registration.
func TestRegisterNotificationAgent(t *testing.T) {
	q := NewNotificationQueue()
	agent := &mockAgent{name: "agent-1", isConsumer: true}
	q.RegisterNotificationAgent(agent)

	if len(q.Agents) != 1 {
		t.Fatalf("expected 1 agent after registration, got %d", len(q.Agents))
	}
}

// TestRegisterNotificationAgent_Multiple verifies that multiple agents can be
// registered independently.
func TestRegisterNotificationAgent_Multiple(t *testing.T) {
	q := NewNotificationQueue()
	q.RegisterNotificationAgent(&mockAgent{name: "agent-a", isConsumer: true})
	q.RegisterNotificationAgent(&mockAgent{name: "agent-b", isConsumer: true})

	if len(q.Agents) != 2 {
		t.Errorf("expected 2 agents, got %d", len(q.Agents))
	}
}

// TestBroadcastNotification_DeliveredToEnabledAgent verifies that a message is
// delivered to an agent that appears in the ReciverAgents list.
func TestBroadcastNotification_DeliveredToEnabledAgent(t *testing.T) {
	q := NewNotificationQueue()
	agent := &mockAgent{name: "email-agent", isConsumer: true}
	q.RegisterNotificationAgent(agent)

	payload := &NotificationPayload{
		ID:            "msg-001",
		Title:         "Hello",
		Message:       "Test message",
		Receiver:      []string{"alice"},
		Sender:        "system",
		ReciverAgents: []string{"email-agent"},
	}

	err := q.BroadcastNotification(payload)
	if err != nil {
		t.Fatalf("unexpected error from BroadcastNotification: %v", err)
	}

	if len(agent.receivedMsgs) != 1 {
		t.Errorf("expected agent to receive 1 message, got %d", len(agent.receivedMsgs))
	}
	if agent.receivedMsgs[0].ID != "msg-001" {
		t.Errorf("unexpected message ID: %s", agent.receivedMsgs[0].ID)
	}
}

// TestBroadcastNotification_SkipsUnlistedAgent verifies that agents not
// present in ReciverAgents do not receive the notification.
func TestBroadcastNotification_SkipsUnlistedAgent(t *testing.T) {
	q := NewNotificationQueue()
	agent := &mockAgent{name: "sms-agent", isConsumer: true}
	q.RegisterNotificationAgent(agent)

	payload := &NotificationPayload{
		ID:            "msg-002",
		Title:         "Hello",
		Message:       "Test message",
		Receiver:      []string{"bob"},
		Sender:        "system",
		ReciverAgents: []string{"email-agent"}, // "sms-agent" is NOT listed
	}

	_ = q.BroadcastNotification(payload)

	if len(agent.receivedMsgs) != 0 {
		t.Errorf("expected agent to receive 0 messages, got %d", len(agent.receivedMsgs))
	}
}

// TestBroadcastNotification_AgentErrorContinues verifies that a delivery error
// from one agent does not prevent other agents from receiving the notification.
func TestBroadcastNotification_AgentErrorContinues(t *testing.T) {
	q := NewNotificationQueue()
	failing := &mockAgent{name: "failing-agent", isConsumer: true, returnErr: errors.New("send failed")}
	succeeding := &mockAgent{name: "ok-agent", isConsumer: true}
	q.RegisterNotificationAgent(failing)
	q.RegisterNotificationAgent(succeeding)

	payload := &NotificationPayload{
		ID:            "msg-003",
		Title:         "Alert",
		Message:       "Something happened",
		Receiver:      []string{"carol"},
		Sender:        "system",
		ReciverAgents: []string{"failing-agent", "ok-agent"},
	}

	err := q.BroadcastNotification(payload)
	if err != nil {
		t.Fatalf("unexpected error from BroadcastNotification: %v", err)
	}

	// The succeeding agent should still receive the message.
	if len(succeeding.receivedMsgs) != 1 {
		t.Errorf("expected succeeding agent to receive 1 message, got %d", len(succeeding.receivedMsgs))
	}
}

// TestBroadcastNotification_EmptyAgents verifies that broadcasting with no
// registered agents is a no-op and returns nil.
func TestBroadcastNotification_EmptyAgents(t *testing.T) {
	q := NewNotificationQueue()
	payload := &NotificationPayload{
		ID:            "msg-004",
		Title:         "No agents",
		Message:       "Test",
		ReciverAgents: []string{"any-agent"},
	}

	err := q.BroadcastNotification(payload)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// TestNotificationPayload_Fields verifies that the NotificationPayload struct
// holds all fields correctly.
func TestNotificationPayload_Fields(t *testing.T) {
	p := NotificationPayload{
		ID:            "id-1",
		Title:         "title",
		Message:       "msg",
		Receiver:      []string{"user1", "user2"},
		Sender:        "module-x",
		Priority:      PriorityHigh,
		ReciverAgents: []string{"agent-a"},
	}

	if p.ID != "id-1" {
		t.Errorf("unexpected ID: %s", p.ID)
	}
	if len(p.Receiver) != 2 {
		t.Errorf("expected 2 receivers, got %d", len(p.Receiver))
	}
	if p.Priority != PriorityHigh {
		t.Errorf("unexpected Priority: %d", p.Priority)
	}
}

// TestPriorityFromString verifies the string -> priority mapping including the
// fallback for unknown values.
func TestPriorityFromString(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"low", PriorityLow},
		{"LOW", PriorityLow},
		{"medium", PriorityMedium},
		{"normal", PriorityMedium},
		{"high", PriorityHigh},
		{"  High ", PriorityHigh},
		{"urgent", PriorityHigh},
		{"nonsense", PriorityMedium},
		{"", PriorityMedium},
	}
	for _, c := range cases {
		if got := PriorityFromString(c.in); got != c.want {
			t.Errorf("PriorityFromString(%q) = %d, want %d", c.in, got, c.want)
		}
	}
}

// TestPriorityToString verifies the priority -> string mapping round-trips the
// known constants and defaults unknown values to medium.
func TestPriorityToString(t *testing.T) {
	cases := []struct {
		in   int
		want string
	}{
		{PriorityLow, "low"},
		{PriorityMedium, "medium"},
		{PriorityHigh, "high"},
		{0, "medium"},
		{99, "medium"},
	}
	for _, c := range cases {
		if got := PriorityToString(c.in); got != c.want {
			t.Errorf("PriorityToString(%d) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestNormalizePriority verifies clamping of out-of-range priority values.
func TestNormalizePriority(t *testing.T) {
	cases := []struct {
		in   int
		want int
	}{
		{0, PriorityMedium},
		{-5, PriorityMedium},
		{PriorityLow, PriorityLow},
		{PriorityMedium, PriorityMedium},
		{PriorityHigh, PriorityHigh},
		{100, PriorityHigh},
	}
	for _, c := range cases {
		if got := NormalizePriority(c.in); got != c.want {
			t.Errorf("NormalizePriority(%d) = %d, want %d", c.in, got, c.want)
		}
	}
}

// TestGetAgentByName verifies lookup of a registered agent by name.
func TestGetAgentByName(t *testing.T) {
	q := NewNotificationQueue()
	q.RegisterNotificationAgent(&mockAgent{name: "agent-x", isConsumer: true})

	if got := q.GetAgentByName("agent-x"); got == nil || got.Name() != "agent-x" {
		t.Errorf("expected to find agent-x, got %v", got)
	}
	if got := q.GetAgentByName("missing"); got != nil {
		t.Errorf("expected nil for missing agent, got %v", got)
	}
}

// TestListConsumerAgentNames verifies that only consumer agents are listed.
func TestListConsumerAgentNames(t *testing.T) {
	q := NewNotificationQueue()
	q.RegisterNotificationAgent(&mockAgent{name: "consumer-1", isConsumer: true})
	q.RegisterNotificationAgent(&mockAgent{name: "producer-only", isConsumer: false, isProducer: true})

	names := q.ListConsumerAgentNames()
	if len(names) != 1 || names[0] != "consumer-1" {
		t.Errorf("expected [consumer-1], got %v", names)
	}
}
