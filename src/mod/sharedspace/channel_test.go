package sharedspace

import (
	"path/filepath"
	"sync"
	"testing"
)

func newChannelTestSpace(t *testing.T, access string) *Space {
	t.Helper()
	m := NewManager(filepath.Join(t.TempDir(), "spaces"), 0)
	space, err := m.CreateSpaceWithOptions("alice", "Channel test", SpaceOptions{Access: access})
	if err != nil {
		t.Fatalf("CreateSpaceWithOptions() error = %v", err)
	}
	return space
}

func TestChannelJoinLeave(t *testing.T) {
	space := newChannelTestSpace(t, AccessOpen)
	channel := space.Channel()
	if channel != space.Channel() {
		t.Fatalf("Channel() is not stable")
	}

	a, err := channel.Join("alice")
	if err != nil {
		t.Fatalf("Join(alice) error = %v", err)
	}
	b, err := channel.Join("bob")
	if err != nil {
		t.Fatalf("Join(bob) error = %v", err)
	}
	if a.ID == b.ID || a.ID < 1 || b.ID < 1 {
		t.Errorf("subscriber IDs invalid: %d, %d (must be unique, 1-based)", a.ID, b.ID)
	}
	if channel.Count() != 2 {
		t.Errorf("Count() = %d, want 2", channel.Count())
	}
	if got, ok := channel.Get(b.ID); !ok || got != b {
		t.Errorf("Get(%d) did not return bob", b.ID)
	}

	channel.Leave(b.ID)
	if channel.Count() != 1 {
		t.Errorf("Count() after leave = %d, want 1", channel.Count())
	}
	if _, open := <-b.Send; open {
		t.Errorf("left subscriber's send channel still open")
	}
	//Leaving twice or with an unknown ID must not panic
	channel.Leave(b.ID)
	channel.Leave(9999)
}

func TestChannelACL(t *testing.T) {
	space := newChannelTestSpace(t, AccessPrivate)
	channel := space.Channel()

	if _, err := channel.Join("stranger"); err != ErrPermissionDenied {
		t.Errorf("stranger Join error = %v, want ErrPermissionDenied", err)
	}
	if _, err := channel.Join("alice"); err != nil {
		t.Errorf("owner Join error = %v", err)
	}
	space.AddMember("alice", "mia", RoleMember)
	if _, err := channel.Join("mia"); err != nil {
		t.Errorf("member Join error = %v", err)
	}
}

func TestChannelBroadcastAndSendTo(t *testing.T) {
	space := newChannelTestSpace(t, AccessOpen)
	channel := space.Channel()
	a, _ := channel.Join("alice")
	b, _ := channel.Join("bob")
	c, _ := channel.Join("carol")

	channel.Broadcast([]byte("hello"), a.ID)
	for _, sub := range []*Subscriber{b, c} {
		select {
		case msg := <-sub.Send:
			if string(msg) != "hello" {
				t.Errorf("%s received %q, want hello", sub.Username, msg)
			}
		default:
			t.Errorf("%s received nothing from broadcast", sub.Username)
		}
	}
	select {
	case msg := <-a.Send:
		t.Errorf("excluded sender received %q", msg)
	default:
	}

	if !channel.SendTo(b.ID, []byte("direct")) {
		t.Errorf("SendTo(%d) = false, want true", b.ID)
	}
	if msg := <-b.Send; string(msg) != "direct" {
		t.Errorf("b received %q, want direct", msg)
	}
	if channel.SendTo(9999, []byte("direct")) {
		t.Errorf("SendTo(unknown) = true, want false")
	}

	//Broadcast must not alias the caller's buffer
	frame := []byte(`{"type":"chat"}`)
	channel.Broadcast(frame, -1)
	frame[2] = 'X'
	if msg := <-a.Send; string(msg) != `{"type":"chat"}` {
		t.Errorf("broadcast frame mutated by caller: %q", msg)
	}
}

func TestChannelBufferFullDrops(t *testing.T) {
	space := newChannelTestSpace(t, AccessOpen)
	channel := space.Channel()
	a, _ := channel.Join("alice")

	//Fill the buffer past capacity: the hub must not block
	for i := 0; i < SubscriberSendBuffer+10; i++ {
		channel.Broadcast([]byte("x"), -1)
	}
	if len(a.Send) != SubscriberSendBuffer {
		t.Errorf("send buffer = %d frames, want %d (overflow dropped)", len(a.Send), SubscriberSendBuffer)
	}
}

func TestChannelClose(t *testing.T) {
	space := newChannelTestSpace(t, AccessOpen)
	channel := space.Channel()
	a, _ := channel.Join("alice")
	channel.Join("bob")

	members := channel.Close()
	if len(members) != 2 {
		t.Errorf("Close() returned %d members, want 2", len(members))
	}
	if _, open := <-a.Send; open {
		t.Errorf("send channel still open after Close")
	}
	if _, err := channel.Join("late"); err != ErrSpaceClosed {
		t.Errorf("Join after Close error = %v, want ErrSpaceClosed", err)
	}
	//Closing twice must not panic
	if again := channel.Close(); len(again) != 0 {
		t.Errorf("second Close() returned %d members, want 0", len(again))
	}
}

func TestDeleteSpaceClosesChannel(t *testing.T) {
	m := NewManager(filepath.Join(t.TempDir(), "spaces"), 0)
	space := m.CreateSpace("alice", "")
	channel := space.Channel()
	a, _ := channel.Join("alice")

	m.DeleteSpace(space.ID)
	if _, open := <-a.Send; open {
		t.Errorf("subscriber send channel still open after DeleteSpace")
	}
	if _, err := channel.Join("late"); err != ErrSpaceClosed {
		t.Errorf("Join after DeleteSpace error = %v, want ErrSpaceClosed", err)
	}
}

func TestStandaloneChannel(t *testing.T) {
	channel := NewStandaloneChannel()
	//No space, no ACL: anyone joins
	a, err := channel.Join("anyone")
	if err != nil {
		t.Fatalf("standalone Join error = %v", err)
	}
	channel.Broadcast([]byte("ping"), -1)
	if msg := <-a.Send; string(msg) != "ping" {
		t.Errorf("standalone broadcast = %q", msg)
	}
}

func TestChannelPresenceHooks(t *testing.T) {
	space := newChannelTestSpace(t, AccessOpen)
	channel := space.Channel()

	var mu sync.Mutex
	joins := []string{}
	leaves := []string{}
	channel.SetPresenceHooks(
		func(sub *Subscriber) {
			//Hooks must run outside the channel lock: calling back into the
			//channel here must not deadlock
			channel.Count()
			mu.Lock()
			joins = append(joins, sub.Username)
			mu.Unlock()
		},
		func(sub *Subscriber) {
			channel.Count()
			mu.Lock()
			leaves = append(leaves, sub.Username)
			mu.Unlock()
		},
	)

	a, _ := channel.Join("alice")
	channel.Leave(a.ID)

	mu.Lock()
	defer mu.Unlock()
	if len(joins) != 1 || joins[0] != "alice" {
		t.Errorf("join hook calls = %v", joins)
	}
	if len(leaves) != 1 || leaves[0] != "alice" {
		t.Errorf("leave hook calls = %v", leaves)
	}
}

func TestChannelConcurrentUse(t *testing.T) {
	//Exercises the lock discipline under -race: concurrent joins, posts,
	//broadcasts and leaves must be data-race free and deadlock free.
	space := newChannelTestSpace(t, AccessOpen)
	channel := space.Channel()

	var wg sync.WaitGroup
	for worker := 0; worker < 8; worker++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			for i := 0; i < 50; i++ {
				sub, err := channel.Join("user")
				if err != nil {
					return
				}
				channel.Broadcast([]byte("frame"), sub.ID)
				if n%2 == 0 {
					space.AddText("user", "message", "test")
				}
				//Drain a little so buffers do not saturate
				select {
				case <-sub.Send:
				default:
				}
				channel.Leave(sub.ID)
			}
		}(worker)
	}
	wg.Wait()
	if channel.Count() != 0 {
		t.Errorf("Count() after concurrent churn = %d, want 0", channel.Count())
	}
}
