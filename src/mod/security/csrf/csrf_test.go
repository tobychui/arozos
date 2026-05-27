package csrf

import (
	"testing"
	"time"
)

// NewTokenManager accepts a nil *user.UserHandler because it only stores the
// pointer without dereferencing it in GenerateNewToken / CheckTokenValidation.
func newTestTokenManager(expireSeconds int64) *TokenManager {
	return NewTokenManager(nil, expireSeconds)
}

func TestNewTokenManager(t *testing.T) {
	tm := newTestTokenManager(300)
	if tm == nil {
		t.Fatal("NewTokenManager returned nil")
	}
	if tm.defaultTokenExpireTime != 300 {
		t.Errorf("expected defaultTokenExpireTime=300, got %d", tm.defaultTokenExpireTime)
	}
	if tm.csrfTokens == nil {
		t.Error("csrfTokens sync.Map should be initialised")
	}
}

func TestGenerateNewToken(t *testing.T) {
	tm := newTestTokenManager(300)
	tok := tm.GenerateNewToken("alice")
	if tok == "" {
		t.Fatal("GenerateNewToken returned empty string")
	}
	// A second call must produce a different token
	tok2 := tm.GenerateNewToken("alice")
	if tok == tok2 {
		t.Error("two consecutive tokens should differ")
	}
}

func TestGetUserTokenMap(t *testing.T) {
	tm := newTestTokenManager(300)
	// First call should create a fresh map
	m1 := tm.GetUserTokenMap("bob")
	if m1 == nil {
		t.Fatal("GetUserTokenMap returned nil")
	}
	// Second call for same user should return the same map pointer
	m2 := tm.GetUserTokenMap("bob")
	if m1 != m2 {
		t.Error("expected same *sync.Map for the same user")
	}
	// Different user should return a different map
	m3 := tm.GetUserTokenMap("carol")
	if m1 == m3 {
		t.Error("different users should have different sync.Maps")
	}
}

func TestCheckTokenValidation_Valid(t *testing.T) {
	tm := newTestTokenManager(300)
	tok := tm.GenerateNewToken("alice")
	if !tm.CheckTokenValidation("alice", tok) {
		t.Error("expected valid token to pass validation")
	}
}

func TestCheckTokenValidation_Invalid(t *testing.T) {
	tm := newTestTokenManager(300)
	if tm.CheckTokenValidation("alice", "nonexistent-token") {
		t.Error("expected unknown token to fail validation")
	}
}

func TestCheckTokenValidation_WrongUser(t *testing.T) {
	tm := newTestTokenManager(300)
	tok := tm.GenerateNewToken("alice")
	// Token belongs to alice, not bob
	if tm.CheckTokenValidation("bob", tok) {
		t.Error("token from alice should not validate for bob")
	}
}

func TestCheckTokenValidation_Expired(t *testing.T) {
	// Create manager with 0 second TTL so tokens are immediately expired
	tm := newTestTokenManager(0)
	tok := tm.GenerateNewToken("alice")
	// Sleep briefly to ensure Unix timestamp advances past expiry
	time.Sleep(2 * time.Second)
	if tm.CheckTokenValidation("alice", tok) {
		t.Error("expired token should fail validation")
	}
}

func TestCheckTokenValidation_ConsumedAfterUse(t *testing.T) {
	tm := newTestTokenManager(300)
	tok := tm.GenerateNewToken("alice")
	// First use should succeed
	if !tm.CheckTokenValidation("alice", tok) {
		t.Fatal("first validation should succeed")
	}
	// Token is deleted after validation; second use must fail
	if tm.CheckTokenValidation("alice", tok) {
		t.Error("token should be consumed after first use")
	}
}

func TestClearExpiredTokens(t *testing.T) {
	tm := newTestTokenManager(0)
	tm.GenerateNewToken("alice")
	tm.GenerateNewToken("alice")
	time.Sleep(2 * time.Second)
	// Should not panic and should remove expired tokens
	tm.ClearExpiredTokens()
	// Verify the map is effectively empty for alice
	m := tm.GetUserTokenMap("alice")
	count := 0
	m.Range(func(_, _ interface{}) bool { count++; return true })
	if count != 0 {
		t.Errorf("expected 0 tokens after ClearExpiredTokens, got %d", count)
	}
}
