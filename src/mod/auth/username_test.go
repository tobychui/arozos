package auth

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestValidateUsername(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr string
	}{
		{name: "plain", input: "alice"},
		{name: "digits and symbols", input: "bob_2.smith-jr"},
		{name: "email style", input: "carol@example.com"},
		{name: "starts with a digit", input: "2fa"},
		{name: "chinese", input: "陳大文"},
		{name: "japanese", input: "やまだ"},
		{name: "hindi with combining marks", input: "प्रिया"},
		{name: "longest allowed", input: strings.Repeat("a", MaxUsernameLength)},
		{name: "empty", input: "", wantErr: "empty"},
		{name: "too long", input: strings.Repeat("a", MaxUsernameLength+1), wantErr: "too long"},
		{name: "slash", input: "a/b", wantErr: `"/"`},
		{name: "backslash", input: `a\b`, wantErr: `"\\"`},
		{name: "parent folder", input: "..", wantErr: "start with"},
		{name: "dots inside", input: "a..b", wantErr: `".."`},
		{name: "leading dot", input: ".hidden", wantErr: "start with"},
		{name: "leading dash", input: "-rf", wantErr: "start with"},
		{name: "space", input: "john doe", wantErr: "spaces"},
		{name: "colon", input: "user:x", wantErr: `":"`},
		{name: "control character", input: "a\nb", wantErr: "control"},
		{name: "zero width space", input: "a\u200bb", wantErr: "control"},
		{name: "windows device", input: "con", wantErr: "reserved by Windows"},
		{name: "windows device with extension", input: "LPT1.backup", wantErr: "reserved by Windows"},
		{name: "device name inside a longer name", input: "console"},
		{name: "invalid utf8", input: "a\xffb", wantErr: "not valid text"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateUsername(tt.input)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("ValidateUsername(%q) unexpected error: %v", tt.input, err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("ValidateUsername(%q) error = %v, want it to contain %q", tt.input, err, tt.wantErr)
			}
		})
	}
}

// Every way of creating an account goes through CreateUserAccount, so a bad
// name never reaches the database
func TestCreateUserAccountRefusesUnsafeNames(t *testing.T) {
	a := newHashOnlyAgent(t)
	for _, name := range []string{"../admin", "a/b", "nul", " alice"} {
		if err := a.CreateUserAccount(name, "password", []string{"user"}); err == nil {
			t.Errorf("CreateUserAccount(%q) accepted an unsafe name", name)
		}
		if a.UserExists(name) {
			t.Errorf("CreateUserAccount(%q) stored the account anyway", name)
		}
	}
	if err := a.CreateUserAccount("alice", "password", []string{"user"}); err != nil {
		t.Fatalf("CreateUserAccount(alice): %v", err)
	}
	if !a.UserExists("alice") {
		t.Error("alice was not stored")
	}
}

// The register endpoint passes the reason on to the page
func TestHandleRegisterRefusesUnsafeNames(t *testing.T) {
	a := newTestAuthAgent(t, map[string]bool{"root": true})
	if err := a.CreateUserAccount("root", "rootpass", []string{"administrator"}); err != nil {
		t.Fatalf("CreateUserAccount(root): %v", err)
	}
	cookies := sessionCookies(t, a, "root")
	body := postRegister(a, cookies, "../root2", "secret", "user")
	if !strings.Contains(body, "start with a letter") || a.UserExists("../root2") {
		t.Errorf("register reply %s, stored %v", body, a.UserExists("../root2"))
	}
}

// The batch import reports the names it skipped instead of failing silently
func TestCSVImportReportsInvalidNames(t *testing.T) {
	a := newTestAuthAgent(t, nil)
	form := url.Values{"csv": {"dave,pass1234,user\n../evil,pass1234,user\nerin smith,pass1234,user"}}
	req := httptest.NewRequest(http.MethodPost, "/system/auth/csvimport", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	a.HandleCreateUserAccountsFromCSV(rec, req)
	body := rec.Body.String()
	if !strings.Contains(body, "../evil skipped") || !strings.Contains(body, "erin smith skipped") {
		t.Errorf("reply %s should name both skipped users", body)
	}
	if !a.UserExists("dave") || a.UserExists("../evil") || a.UserExists("erin smith") {
		t.Errorf("wrong accounts stored: dave=%v evil=%v erin=%v", a.UserExists("dave"), a.UserExists("../evil"), a.UserExists("erin smith"))
	}
}
