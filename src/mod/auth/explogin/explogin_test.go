package explogin

import (
	"net/http"
	"testing"
)

func TestAllowImmediateAccess_FirstAttempt(t *testing.T) {
	handler := NewExponentialLoginHandler(2, 10)
	username := "testuser"
	request, _ := http.NewRequest("GET", "/", nil)

	allowed, _ := handler.AllowImmediateAccess(username, request)

	if !allowed {
		t.Error("Access should be allowed for the first attempt")
	}
}

func TestAllowImmediateAccess_LimitExceeded(t *testing.T) {
	handler := NewExponentialLoginHandler(2, 10)
	username := "testuser"
	request, _ := http.NewRequest("GET", "/", nil)

	// Set the retry count to a value exceeding the limit
	handler.AddUserRetrycount(username, request)
	handler.AddUserRetrycount(username, request)
	handler.AddUserRetrycount(username, request)

	allowed, _ := handler.AllowImmediateAccess(username, request)

	if allowed {
		t.Error("Access should be denied when retry count exceeds the limit")
	}
}

func TestAddUserRetrycount(t *testing.T) {
	handler := NewExponentialLoginHandler(2, 10)
	username := "testuser"
	request, _ := http.NewRequest("GET", "/", nil)

	handler.AddUserRetrycount(username, request)

	entry, exists := handler.LoginRecord.Load(username + "/0.0.0.0")

	if !exists {
		t.Error("User entry should exist after failed login attempt")
	}

	loginEntry := entry.(*UserLoginEntry)

	if loginEntry.RetryCount != 1 {
		t.Errorf("Retry count should be 1, got %d", loginEntry.RetryCount)
	}
}

func TestResetUserRetryCount(t *testing.T) {
	handler := NewExponentialLoginHandler(2, 10)
	username := "testuser"
	request, _ := http.NewRequest("GET", "/", nil)

	handler.AddUserRetrycount(username, request)
	handler.ResetUserRetryCount(username, request)

	_, exists := handler.LoginRecord.Load(username + "/0.0.0.0")

	if exists {
		t.Error("User entry should be reset after successful login")
	}
}

func TestResetAllUserRetryCounter(t *testing.T) {
	handler := NewExponentialLoginHandler(2, 10)
	username1 := "testuser1"
	username2 := "testuser2"
	request, _ := http.NewRequest("GET", "/", nil)

	handler.AddUserRetrycount(username1, request)
	handler.AddUserRetrycount(username2, request)

	handler.ResetAllUserRetryCounter()

	_, exists1 := handler.LoginRecord.Load(username1 + "/0.0.0.0")
	_, exists2 := handler.LoginRecord.Load(username2 + "/0.0.0.0")

	if exists1 || exists2 {
		t.Error("All user entries should be reset")
	}
}

func TestGetDelayTimeFromRetryCount(t *testing.T) {
	handler := NewExponentialLoginHandler(2, 10)

	// Test with different retry counts
	tests := []struct {
		retryCount int
		expected   int64
	}{
		{1, 2},
		{2, 3},
		{3, 5},
		{4, 9},
		{5, 10},
		{6, 10}, // Exceeds the DelayCeiling
	}

	for _, test := range tests {
		result := handler.getDelayTimeFromRetryCount(test.retryCount)

		if result != test.expected {
			t.Errorf("For RetryCount %d, expected delay %d, got %d", test.retryCount, test.expected, result)
		}
	}
}

func TestAllowImmediateAccess_DeniedUntilNextRetry(t *testing.T) {
	handler := NewExponentialLoginHandler(2, 10)
	username := "testuser"
	request, _ := http.NewRequest("GET", "/", nil)

	// Deny access and retrieve the remaining time until the next retry
	handler.AddUserRetrycount(username, request)
	handler.AddUserRetrycount(username, request)
	handler.AddUserRetrycount(username, request)
	allowed, remainingTime := handler.AllowImmediateAccess(username, request)
	//t.Log(allowed, remainingTime)
	if allowed || remainingTime == 0 {
		t.Error("Access should be denied, and remaining time should be greater than 0")
	}
}

func TestAllowImmediateAccess_IPNotFound(t *testing.T) {
	handler := NewExponentialLoginHandler(2, 10)
	username := "testuser"
	request, _ := http.NewRequest("GET", "/", nil)

	allowed, _ := handler.AllowImmediateAccess(username, request)

	if !allowed {
		t.Error("Access should be allowed even if IP information is not found")
	}
}
