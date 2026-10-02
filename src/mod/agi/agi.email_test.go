package agi

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/email"
	"imuslab.com/arozos/mod/permission"
	user "imuslab.com/arozos/mod/user"
)

// newEmailTestVM injects the email library for a user into a fresh VM.
func newEmailTestVM(t *testing.T, manager *email.Manager, u *user.User) *otto.Otto {
	t.Helper()
	g := &Gateway{Option: &AgiSysInfo{EmailManager: manager}}
	vm := otto.New()
	g.injectEmailLibFunctions(&static.AgiLibInjectionPayload{VM: vm, User: u})
	return vm
}

func newEmailTestManager(t *testing.T) *email.Manager {
	t.Helper()
	manager, err := email.NewManager(email.Options{DataDir: t.TempDir(), DisableBackground: true})
	if err != nil {
		t.Fatalf("email.NewManager: %v", err)
	}
	t.Cleanup(manager.Close)
	return manager
}

// runEmailScript evaluates an expression and decodes its JSON result.
func runEmailScript(t *testing.T, vm *otto.Otto, script string) map[string]interface{} {
	t.Helper()
	value, err := vm.Run("JSON.stringify(" + script + ")")
	if err != nil {
		t.Fatalf("script %q failed: %v", script, err)
	}
	text, _ := value.ToString()
	decoded := map[string]interface{}{}
	if err := json.Unmarshal([]byte(text), &decoded); err != nil {
		t.Fatalf("script %q returned %q: %v", script, text, err)
	}
	return decoded
}

func TestEmailLibWrapperDefinesEveryFunction(t *testing.T) {
	vm := newEmailTestVM(t, newEmailTestManager(t), &user.User{Username: "alice"})
	names := []string{
		"providers", "discover", "oauthProviders", "oauthStart", "oauthComplete", "oauthStatus", "oauthCancel",
		"listAccounts", "getAccount", "testAccount", "addAccount", "updateAccount", "removeAccount", "reorderAccounts",
		"folders", "createFolder", "renameFolder", "deleteFolder", "emptyFolder", "markAllRead",
		"list", "unified", "get", "rawSource", "setFlag", "move", "copy", "moveToRole", "remove", "locate",
		"checkInboxes", "newSince", "saveMessage", "saveAttachment", "saveAllAttachments", "openEml",
		"saveEmlAttachment", "importEml", "tempFolder", "send", "saveDraft", "deleteDraft", "outbox",
		"outboxCancel", "outboxSendNow", "contacts", "searchContacts", "saveContact", "deleteContact",
		"importContacts", "labels", "saveLabels", "setLabels", "labelMessages", "snooze", "unsnooze",
		"snoozed", "settings", "saveSettings", "trustSender", "isAdmin", "adminConfig", "setAdminConfig",
	}
	for _, name := range names {
		value, err := vm.Run("typeof email." + name)
		if err != nil {
			t.Fatalf("typeof email.%s: %v", name, err)
		}
		if kind, _ := value.ToString(); kind != "function" {
			t.Errorf("email.%s is %s, want function", name, kind)
		}
	}
}

func TestEmailLibEnvelopes(t *testing.T) {
	vm := newEmailTestVM(t, newEmailTestManager(t), &user.User{Username: "alice"})

	providers := runEmailScript(t, vm, `email.providers()`)
	if providers["success"] != true {
		t.Fatalf("providers = %v", providers)
	}
	if list, ok := providers["data"].([]interface{}); !ok || len(list) < 5 {
		t.Errorf("providers data = %v", providers["data"])
	}

	discovered := runEmailScript(t, vm, `email.discover("someone@gmail.com")`)
	data, _ := discovered["data"].(map[string]interface{})
	if discovered["success"] != true || data["provider"] != "gmail" {
		t.Errorf("discover = %v", discovered)
	}

	accounts := runEmailScript(t, vm, `email.listAccounts()`)
	if accounts["success"] != true {
		t.Errorf("listAccounts = %v", accounts)
	}

	missing := runEmailScript(t, vm, `email.list("no-such-account", {folder: "INBOX"})`)
	if missing["success"] != false || missing["code"] != "notfound" {
		t.Errorf("unknown account should fail with notfound, got %v", missing)
	}

	saved := runEmailScript(t, vm, `email.saveSettings({density: "compact", undoSendSeconds: 10})`)
	if saved["success"] != true {
		t.Fatalf("saveSettings = %v", saved)
	}
	settings := runEmailScript(t, vm, `email.settings()`)
	values, _ := settings["data"].(map[string]interface{})
	if values["density"] != "compact" || values["undoSendSeconds"] != float64(10) || values["theme"] != "system" {
		t.Errorf("settings = %v", values)
	}
}

func TestEmailLibAdminGate(t *testing.T) {
	manager := newEmailTestManager(t)
	regular := newEmailTestVM(t, manager, &user.User{Username: "bob"})
	if result := runEmailScript(t, regular, `email.adminConfig()`); result["success"] != false {
		t.Errorf("a regular user read the admin configuration: %v", result)
	}
	if result := runEmailScript(t, regular, `email.setAdminConfig({allowPrivateHosts: true})`); result["success"] != false {
		t.Errorf("a regular user changed the admin configuration: %v", result)
	}

	admin := newEmailTestVM(t, manager, &user.User{Username: "root", PermissionGroup: []*permission.PermissionGroup{{Name: "administrator", IsAdmin: true}}})
	if result := runEmailScript(t, admin, `email.setAdminConfig({allowPrivateHosts: true, microsoft: {enabled: true, clientId: "abc", flow: "device"}})`); result["success"] != true {
		t.Fatalf("admin setAdminConfig = %v", result)
	}
	config := runEmailScript(t, admin, `email.adminConfig()`)
	data, _ := config["data"].(map[string]interface{})
	if data["allowPrivateHosts"] != true {
		t.Errorf("admin config = %v", data)
	}
	if providers := runEmailScript(t, regular, `email.oauthProviders()`); !strings.Contains(mustJSON(providers), `"enabled":true`) {
		t.Errorf("the configured Microsoft sign-in is not offered: %v", providers)
	}
}

func TestEmailLibWithoutManager(t *testing.T) {
	vm := newEmailTestVM(t, nil, &user.User{Username: "alice"})
	result := runEmailScript(t, vm, `email.listAccounts()`)
	if result["success"] != false || !strings.Contains(result["error"].(string), "not enabled") {
		t.Errorf("listAccounts without a manager = %v", result)
	}
}

func TestEmailFailureClassification(t *testing.T) {
	vm := otto.New()
	tests := []struct {
		name  string
		err   error
		check func(map[string]interface{}) bool
	}{
		{"auth error carries hint", &email.AuthError{Server: "IMAP", Detail: "bad", Hint: "use an app password"}, func(m map[string]interface{}) bool {
			return m["authFailed"] == true && m["hint"] == "use an app password"
		}},
		{"not found", email.ErrMessageNotFound, func(m map[string]interface{}) bool { return m["code"] == "notfound" }},
		{"blocked", email.ErrBlockedAddress, func(m map[string]interface{}) bool { return m["code"] == "blocked" }},
		{"plain error", errors.New("boom"), func(m map[string]interface{}) bool {
			_, hasCode := m["code"]
			return m["error"] == "boom" && !hasCode && m["authFailed"] == nil
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			text, _ := emailFailureWith(vm, test.err, map[string]interface{}{"authFailed": false, "hint": ""}).ToString()
			decoded := map[string]interface{}{}
			if err := json.Unmarshal([]byte(text), &decoded); err != nil {
				t.Fatalf("invalid JSON %q", text)
			}
			if decoded["success"] != false || !test.check(decoded) {
				t.Errorf("envelope = %v", decoded)
			}
		})
	}
}

func TestEmailSafeName(t *testing.T) {
	tests := map[string]string{
		"../../secret.txt": "_.._secret.txt",
		"report.pdf":       "report.pdf",
		"  ..  ":           "attachment",
		"a\\b/c.txt":       "a_b_c.txt",
	}
	for input, want := range tests {
		if got := emailSafeName(input); got != want {
			t.Errorf("emailSafeName(%q) = %q, want %q", input, got, want)
		}
	}
}

func mustJSON(value interface{}) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
