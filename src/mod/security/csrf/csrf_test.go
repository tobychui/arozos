package csrf

import (
	"testing"
	"time"
)

func TestNewTokenManager(t *testing.T) {
	// Test case 1: Create with nil user handler and 60 second expiry
	tm := NewTokenManager(nil, 60)
	if tm == nil {
		t.Error("Test case 1 failed. Token manager should not be nil")
	}
	if tm.defaultTokenExpireTime != 60 {
		t.Errorf("Test case 1 failed. Expected 60s expiry, got %d", tm.defaultTokenExpireTime)
	}

	// Test case 2: Create with different expiry time
	tm2 := NewTokenManager(nil, 300)
	if tm2.defaultTokenExpireTime != 300 {
		t.Errorf("Test case 2 failed. Expected 300s expiry, got %d", tm2.defaultTokenExpireTime)
	}
}

func TestGenerateNewToken(t *testing.T) {
	tm := NewTokenManager(nil, 60)

	// Test case 1: Generate token for user
	token1 := tm.GenerateNewToken("testuser")
	if token1 == "" {
		t.Error("Test case 1 failed. Token should not be empty")
	}

	// Test case 2: Generate another token, should be different
	token2 := tm.GenerateNewToken("testuser")
	if token2 == "" {
		t.Error("Test case 2 failed. Second token should not be empty")
	}
	if token1 == token2 {
		t.Error("Test case 2 failed. Tokens should be unique")
	}

	// Test case 3: Generate token for different user
	token3 := tm.GenerateNewToken("anotheruser")
	if token3 == "" {
		t.Error("Test case 3 failed. Token for different user should not be empty")
	}
	if token3 == token1 || token3 == token2 {
		t.Error("Test case 3 failed. Token should be unique across users")
	}
}

func TestCheckTokenValidation(t *testing.T) {
	tm := NewTokenManager(nil, 2) // 2 second expiry for testing

	// Test case 1: Validate newly generated token
	username := "testuser"
	token := tm.GenerateNewToken(username)
	isValid := tm.CheckTokenValidation(username, token)
	if !isValid {
		t.Error("Test case 1 failed. Newly generated token should be valid")
	}

	// Test case 2: Token is consumed after validation (deleted)
	// Trying to validate same token again should fail
	isValid = tm.CheckTokenValidation(username, token)
	if isValid {
		t.Error("Test case 2 failed. Token should be consumed after first use")
	}

	// Test case 3: Validate with wrong username
	token3 := tm.GenerateNewToken(username)
	isValid = tm.CheckTokenValidation("wronguser", token3)
	if isValid {
		t.Error("Test case 3 failed. Token should not be valid for wrong username")
	}

	// Test case 4: Validate with wrong token
	isValid = tm.CheckTokenValidation(username, "wrong-token")
	if isValid {
		t.Error("Test case 4 failed. Wrong token should not be valid")
	}

	// Test case 5: Validate after expiry
	token4 := tm.GenerateNewToken(username)
	time.Sleep(3 * time.Second) // Wait for token to expire
	isValid = tm.CheckTokenValidation(username, token4)
	if isValid {
		t.Error("Test case 5 failed. Expired token should not be valid")
	}

	// Test case 6: Validate empty token
	isValid = tm.CheckTokenValidation(username, "")
	if isValid {
		t.Error("Test case 6 failed. Empty token should not be valid")
	}

	// Test case 7: Validate empty username
	token5 := tm.GenerateNewToken("user2")
	isValid = tm.CheckTokenValidation("", token5)
	if isValid {
		t.Error("Test case 7 failed. Empty username should not be valid")
	}
}

func TestTokenStruct(t *testing.T) {
	// Test case 1: Create token structure
	now := time.Now().Unix()
	token := Token{
		ID:           "test-uuid-1234",
		Creator:      "testuser",
		CreationTime: now,
		Timeout:      60,
	}

	if token.ID != "test-uuid-1234" {
		t.Error("Test case 1 failed. Token ID mismatch")
	}
	if token.Creator != "testuser" {
		t.Error("Test case 1 failed. Creator mismatch")
	}
	if token.CreationTime != now {
		t.Error("Test case 1 failed. Creation time mismatch")
	}
	if token.Timeout != 60 {
		t.Error("Test case 1 failed. Timeout mismatch")
	}
}

func TestTokenManagerConcurrency(t *testing.T) {
	tm := NewTokenManager(nil, 60)

	// Test case 1: Generate tokens concurrently
	done := make(chan bool)
	tokens := make(chan string, 10)

	for i := 0; i < 10; i++ {
		go func(id int) {
			token := tm.GenerateNewToken("concurrent-user")
			tokens <- token
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}
	close(tokens)

	// Verify all tokens are unique
	tokenSet := make(map[string]bool)
	for token := range tokens {
		if tokenSet[token] {
			t.Error("Test case 1 failed. Duplicate token generated concurrently")
		}
		tokenSet[token] = true
	}

	if len(tokenSet) != 10 {
		t.Errorf("Test case 1 failed. Expected 10 unique tokens, got %d", len(tokenSet))
	}
}
