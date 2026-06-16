package turn

import (
	"bytes"
	"net"
	"testing"
	"time"

	pionturn "github.com/pion/turn/v4"
)

func TestBuildAndValidateCredential(t *testing.T) {
	secret := []byte("a-test-secret-value-1234567890ab")
	realm := "arozos"
	now := time.Unix(1_700_000_000, 0)

	tests := []struct {
		name     string
		identity string
	}{
		{"with identity", "alice"},
		{"empty identity", ""},
		{"identity with colon", "user:with:colons"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			username, password := buildCredential(secret, tt.identity, now.Add(time.Hour))
			if username == "" || password == "" {
				t.Fatalf("buildCredential returned empty username/password")
			}

			key, ok := validateCredential(secret, realm, username, now)
			if !ok {
				t.Fatalf("validateCredential rejected a freshly minted credential")
			}
			if len(key) == 0 {
				t.Fatalf("validateCredential returned an empty auth key")
			}
		})
	}
}

func TestValidateCredentialExpired(t *testing.T) {
	secret := []byte("secret")
	realm := "arozos"
	issuedAt := time.Unix(1_700_000_000, 0)

	username, _ := buildCredential(secret, "bob", issuedAt.Add(time.Minute))

	// One second after expiry the credential must be rejected.
	after := issuedAt.Add(time.Minute + time.Second)
	if _, ok := validateCredential(secret, realm, username, after); ok {
		t.Fatalf("expected expired credential to be rejected")
	}

	// Exactly at the issuing moment it must still be valid.
	if _, ok := validateCredential(secret, realm, username, issuedAt); !ok {
		t.Fatalf("expected non-expired credential to be accepted")
	}
}

// validateCredential returns the auth key pion compares against the client's
// STUN MESSAGE-INTEGRITY. It does not itself reject a wrong secret — instead it
// returns a key bound to the secret, so a forged credential yields a key the
// genuine password cannot match and pion rejects it. These tests assert that
// key binding rather than the ok flag.
func TestValidateCredentialKeyBinding(t *testing.T) {
	secret := []byte("real-secret")
	realm := "arozos"
	now := time.Unix(1_700_000_000, 0)

	username, password := buildCredential(secret, "carol", now.Add(time.Hour))
	want := pionturn.GenerateAuthKey(username, realm, password)

	key, ok := validateCredential(secret, realm, username, now)
	if !ok {
		t.Fatalf("valid credential rejected")
	}
	if !bytes.Equal(key, want) {
		t.Fatalf("auth key does not match the issued password; a genuine client would fail to authenticate")
	}

	// A server holding a different secret derives a different key, so the
	// genuine password no longer matches and pion's integrity check fails.
	otherKey, _ := validateCredential([]byte("other-secret"), realm, username, now)
	if bytes.Equal(otherKey, want) {
		t.Fatalf("expected a different key under a different secret")
	}

	// Tampering with the username (e.g. extending the expiry) changes the key
	// the server expects, while the attacker only holds the original password.
	tampered := username + "0"
	tamperedKey, _ := validateCredential(secret, realm, tampered, now)
	if bytes.Equal(tamperedKey, want) {
		t.Fatalf("expected a tampered username to derive a different key")
	}
}

func TestValidateCredentialMalformed(t *testing.T) {
	secret := []byte("secret")
	realm := "arozos"
	now := time.Unix(1_700_000_000, 0)

	for _, username := range []string{"", "not-a-number", "notanumber:identity", ":identity"} {
		if _, ok := validateCredential(secret, realm, username, now); ok {
			t.Fatalf("expected malformed username %q to be rejected", username)
		}
	}
}

func TestResolveRelayIP(t *testing.T) {
	t.Run("explicit IPv4", func(t *testing.T) {
		ip, err := resolveRelayIP("203.0.113.7")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !ip.Equal(net.ParseIP("203.0.113.7")) {
			t.Fatalf("got %v, want 203.0.113.7", ip)
		}
	})

	t.Run("empty auto-detects", func(t *testing.T) {
		ip, err := resolveRelayIP("")
		if err != nil {
			t.Skipf("outbound IP detection unavailable in this environment: %v", err)
		}
		if ip == nil {
			t.Fatalf("expected a non-nil auto-detected IP")
		}
	})

	t.Run("unresolvable hostname errors", func(t *testing.T) {
		if _, err := resolveRelayIP("this-host-does-not-exist.invalid"); err == nil {
			t.Fatalf("expected an error for an unresolvable hostname")
		}
	})
}

func TestNewServerInvalidPort(t *testing.T) {
	for _, port := range []int{0, -1, 70000} {
		if _, err := NewServer(Config{ListenPort: port}); err == nil {
			t.Fatalf("expected error for invalid port %d", port)
		}
	}
}

func TestServerCredentialsRoundTrip(t *testing.T) {
	// Bind on an ephemeral-ish high port; skip gracefully if unavailable.
	srv, err := NewServer(Config{ListenPort: 34780, PublicIP: "127.0.0.1", Realm: "arozos"})
	if err != nil {
		t.Skipf("could not start TURN server in this environment: %v", err)
	}
	defer srv.Close()

	username, password := srv.Credentials("eve")
	if username == "" || password == "" {
		t.Fatalf("Credentials returned empty values")
	}

	// The server must accept its own freshly minted credential.
	key, ok := srv.authHandler(username, srv.Realm(), nil)
	if !ok || len(key) == 0 {
		t.Fatalf("server rejected its own credential")
	}
}
