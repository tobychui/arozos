package sharedspace

/*
	SharedSpace realtime channel

	A Channel is the realtime fan-out hub of a space: WebSocket handlers
	(and any other transport) Join it to receive a numbered Subscriber
	whose Send buffer they drain into their connection. Frames pushed
	through Broadcast / SendTo are opaque bytes - the channel never
	interprets them - so the same hub carries chat delivery, document
	patches, presence and ephemeral WebRTC signaling (MeetRoom runs its
	meeting signaling over room channels).

	Locking rules:
	  - Channel.mu is a leaf lock: no Space method is called and no hook
	    or listener is invoked while it is held. Join / Leave snapshot
	    under the lock and fire the presence hooks after unlocking.
	  - Space.mu -> Channel.mu nesting never occurs: Space.Channel()
	    only constructs the hub, and channel methods never re-enter the
	    space.
	  - Full send buffers drop the frame rather than blocking the hub
	    (same policy as the MeetRoom relay and Arozcast).
*/

import (
	"sync"
	"time"
)

// SubscriberSendBuffer is the per-subscriber outgoing frame buffer size.
const SubscriberSendBuffer = 256

// Subscriber is one connected member of a channel. The transport layer
// drains Send and writes each frame to its connection. IDs are 1-based;
// ID 0 is reserved for server-side senders in transport protocols.
type Subscriber struct {
	ID       int
	Username string
	Send     chan []byte
	joinedAt time.Time
	once     sync.Once
}

// CloseSend closes the subscriber's send channel exactly once.
func (s *Subscriber) CloseSend() {
	s.once.Do(func() { close(s.Send) })
}

// JoinedAt returns when the subscriber joined the channel.
func (s *Subscriber) JoinedAt() time.Time {
	return s.joinedAt
}

// Channel is the realtime hub of a space (or a standalone hub when created
// with NewStandaloneChannel).
type Channel struct {
	space       *Space // nil for standalone channels (no ACL applied on Join)
	subscribers map[int]*Subscriber
	nextID      int
	onJoin      func(*Subscriber)
	onLeave     func(*Subscriber)
	closed      bool
	mu          sync.Mutex
}

// Channel returns the space's realtime hub, creating it on first use. The
// returned pointer is stable for the lifetime of the space.
func (s *Space) Channel() *Channel {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.channel == nil {
		s.channel = &Channel{
			space:       s,
			subscribers: make(map[int]*Subscriber),
			nextID:      1,
			closed:      s.closed,
		}
	}
	return s.channel
}

// NewStandaloneChannel creates a hub that is not bound to any space: Join
// applies no access control. Used by consumers that manage their own
// membership rules (e.g. MeetRoom rooms without a space manager).
func NewStandaloneChannel() *Channel {
	return &Channel{
		subscribers: make(map[int]*Subscriber),
		nextID:      1,
	}
}

// SetPresenceHooks installs callbacks fired after a subscriber joins or
// leaves. Hooks run outside the channel lock; set them once, before the
// first Join, from the subsystem that owns the channel.
func (c *Channel) SetPresenceHooks(onJoin func(*Subscriber), onLeave func(*Subscriber)) {
	c.mu.Lock()
	c.onJoin = onJoin
	c.onLeave = onLeave
	c.mu.Unlock()
}

// Join registers username as a new subscriber. For space-bound channels the
// space's read permission is enforced. The transport layer must drain the
// returned subscriber's Send channel.
func (c *Channel) Join(username string) (*Subscriber, error) {
	if c.space != nil && !c.space.CanRead(username) {
		return nil, ErrPermissionDenied
	}

	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil, ErrSpaceClosed
	}
	sub := &Subscriber{
		ID:       c.nextID,
		Username: username,
		Send:     make(chan []byte, SubscriberSendBuffer),
		joinedAt: time.Now(),
	}
	c.nextID++
	c.subscribers[sub.ID] = sub
	onJoin := c.onJoin
	c.mu.Unlock()

	if onJoin != nil {
		onJoin(sub)
	}
	return sub, nil
}

// Leave unregisters a subscriber and closes its send channel. Safe to call
// twice or with an unknown ID.
func (c *Channel) Leave(id int) {
	c.mu.Lock()
	sub, ok := c.subscribers[id]
	if ok {
		delete(c.subscribers, id)
	}
	onLeave := c.onLeave
	c.mu.Unlock()

	if !ok {
		return
	}
	if onLeave != nil {
		onLeave(sub)
	}
	sub.CloseSend()
}

// Broadcast queues msg to every subscriber except excludeID (pass a negative
// value to send to everyone). Full send buffers drop the frame rather than
// blocking the hub.
func (c *Channel) Broadcast(msg []byte, excludeID int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for id, sub := range c.subscribers {
		if id == excludeID {
			continue
		}
		select {
		case sub.Send <- append([]byte(nil), msg...):
		default:
		}
	}
}

// SendTo queues msg to a single subscriber. It reports whether the
// subscriber exists in the channel.
func (c *Channel) SendTo(id int, msg []byte) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	sub, ok := c.subscribers[id]
	if !ok {
		return false
	}
	select {
	case sub.Send <- append([]byte(nil), msg...):
	default:
	}
	return true
}

// Get returns the subscriber with the given ID.
func (c *Channel) Get(id int) (*Subscriber, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	sub, ok := c.subscribers[id]
	return sub, ok
}

// Subscribers returns a snapshot of the current subscribers.
func (c *Channel) Subscribers() []*Subscriber {
	c.mu.Lock()
	defer c.mu.Unlock()
	list := make([]*Subscriber, 0, len(c.subscribers))
	for _, sub := range c.subscribers {
		list = append(list, sub)
	}
	return list
}

// Count returns the number of connected subscribers.
func (c *Channel) Count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.subscribers)
}

// Close marks the channel closed, removes every subscriber and closes their
// send channels. It returns the removed subscribers so the transport layer
// can finish delivering queued frames before the connections drop. Safe to
// call more than once.
func (c *Channel) Close() []*Subscriber {
	c.mu.Lock()
	c.closed = true
	members := make([]*Subscriber, 0, len(c.subscribers))
	for _, sub := range c.subscribers {
		members = append(members, sub)
	}
	c.subscribers = make(map[int]*Subscriber)
	c.mu.Unlock()

	for _, sub := range members {
		sub.CloseSend()
	}
	return members
}
