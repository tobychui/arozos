package git

import (
	"errors"
	"fmt"
	"testing"

	"github.com/go-git/go-git/v5/plumbing/transport"
)

func TestIsAuthError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "nil error", err: nil, want: false},
		{name: "go-git authentication required", err: transport.ErrAuthenticationRequired, want: true},
		{name: "go-git authorization failed", err: transport.ErrAuthorizationFailed, want: true},
		{name: "package sentinel", err: ErrAuthRequired, want: true},
		{name: "wrapped sentinel", err: fmt.Errorf("push failed: %w", transport.ErrAuthenticationRequired), want: true},
		{name: "github 403", err: errors.New("unexpected client error: 403 Forbidden"), want: true},
		{name: "github 401", err: errors.New("401 Unauthorized"), want: true},
		{name: "bad credentials", err: errors.New("Bad credentials"), want: true},
		{name: "password auth removed", err: errors.New("Support for password authentication was removed"), want: true},
		{name: "case insensitive", err: errors.New("AUTHENTICATION FAILED for repo"), want: true},
		{name: "network failure", err: errors.New("dial tcp: connection refused"), want: false},
		{name: "not found", err: errors.New("repository not found"), want: false},
		{name: "unrelated", err: errors.New("something else went wrong"), want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := IsAuthError(test.err); got != test.want {
				t.Errorf("IsAuthError(%v) = %v, want %v", test.err, got, test.want)
			}
		})
	}
}

func TestClassifyError(t *testing.T) {
	tests := []struct {
		name          string
		err           error
		wantNil       bool
		wantAuth      bool
		wantSameError bool
	}{
		{name: "nil stays nil", err: nil, wantNil: true},
		{name: "auth error is tagged", err: errors.New("401 Unauthorized"), wantAuth: true},
		{name: "other errors pass through", err: errors.New("connection refused"), wantSameError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := classifyError(test.err)

			if test.wantNil {
				if got != nil {
					t.Fatalf("classifyError(nil) = %v, want nil", got)
				}
				return
			}
			if test.wantAuth && !errors.Is(got, ErrAuthRequired) {
				t.Errorf("classifyError(%v) is not ErrAuthRequired", test.err)
			}
			if test.wantSameError && got != test.err {
				t.Errorf("classifyError(%v) = %v, want the original error untouched", test.err, got)
			}
			//The original message must survive so the UI can name the host
			if got.Error() != test.err.Error() {
				t.Errorf("classifyError() message = %q, want %q", got.Error(), test.err.Error())
			}
		})
	}
}

func TestClassifiedAuthErrorUnwraps(t *testing.T) {
	inner := errors.New("403 Forbidden on github.com")
	wrapped := classifyError(inner)

	if !errors.Is(wrapped, ErrAuthRequired) {
		t.Errorf("errors.Is(wrapped, ErrAuthRequired) = false, want true")
	}
	if !errors.Is(wrapped, inner) {
		t.Errorf("errors.Is(wrapped, inner) = false, want the original error to remain reachable")
	}
}
