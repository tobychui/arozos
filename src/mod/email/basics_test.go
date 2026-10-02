package email

import (
	"context"
	"errors"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPresetForDomain(t *testing.T) {
	tests := map[string]string{
		"gmail.com":      "gmail",
		"GoogleMail.com": "gmail",
		"hotmail.co.uk":  "outlook",
		"outlook.jp":     "outlook",
		"live.com":       "outlook",
		"yahoo.co.jp":    "yahoo",
		"icloud.com":     "icloud",
		"me.com":         "icloud",
		"163.com":        "netease",
		"example.com":    "",
	}
	for domain, want := range tests {
		preset, ok := presetForDomain(domain)
		got := ""
		if ok {
			got = preset.ID
		}
		if got != want {
			t.Errorf("presetForDomain(%q) = %q, want %q", domain, got, want)
		}
	}
}

func TestPresetForMX(t *testing.T) {
	tests := map[string]string{
		"aspmx.l.google.com.":                     "gmail",
		"alt1.aspmx.l.google.com":                 "gmail",
		"contoso-com.mail.protection.outlook.com": "office365",
		"mx01.mail.icloud.com.":                   "icloud",
		"mta5.am0.yahoodns.net":                   "yahoo",
		"in1-smtp.messagingengine.com":            "fastmail",
		"mail.example.com":                        "",
		"notgoogle.com":                           "",
	}
	for host, want := range tests {
		preset, ok := presetForMX(host)
		got := ""
		if ok {
			got = preset.ID
		}
		if got != want {
			t.Errorf("presetForMX(%q) = %q, want %q", host, got, want)
		}
	}
}

func TestShouldSaveSent(t *testing.T) {
	tests := []struct {
		account Account
		want    bool
	}{
		{Account{Provider: "gmail", SaveSent: "auto"}, false},
		{Account{Provider: "outlook", SaveSent: "auto"}, false},
		{Account{Provider: "icloud", SaveSent: "auto"}, true},
		{Account{Provider: "custom", SaveSent: "auto", SMTP: ServerConfig{Host: "smtp.gmail.com"}}, false},
		{Account{Provider: "gmail", SaveSent: "always"}, true},
		{Account{Provider: "icloud", SaveSent: "never"}, false},
	}
	for _, test := range tests {
		if got := shouldSaveSent(&test.account); got != test.want {
			t.Errorf("shouldSaveSent(%s/%s) = %v, want %v", test.account.Provider, test.account.SaveSent, got, test.want)
		}
	}
}

func TestIsRestrictedIP(t *testing.T) {
	tests := map[string]bool{
		"127.0.0.1":       true,
		"10.1.2.3":        true,
		"192.168.1.10":    true,
		"172.16.0.1":      true,
		"169.254.1.1":     true,
		"100.100.1.1":     true,
		"0.0.0.0":         true,
		"::1":             true,
		"fe80::1":         true,
		"fd00::1":         true,
		"::ffff:10.0.0.1": true,
		"8.8.8.8":         false,
		"142.250.1.109":   false,
		"2607:f8b0::1":    false,
	}
	for address, want := range tests {
		if got := isRestrictedIP(net.ParseIP(address)); got != want {
			t.Errorf("isRestrictedIP(%s) = %v, want %v", address, got, want)
		}
	}
}

func TestDialGuardedPolicy(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			conn.Close()
		}
	}()
	port := listener.Addr().(*net.TCPAddr).Port

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := dialGuarded(ctx, "127.0.0.1", port, false); !errors.Is(err, ErrBlockedAddress) {
		t.Errorf("loopback literal should be blocked, got %v", err)
	}

	//A public name that resolves to a private address is blocked too
	original := lookupIPAddr
	lookupIPAddr = func(ctx context.Context, host string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("127.0.0.1")}}, nil
	}
	defer func() { lookupIPAddr = original }()
	if _, err := dialGuarded(ctx, "rebind.example.test", port, false); !errors.Is(err, ErrBlockedAddress) {
		t.Errorf("rebinding name should be blocked, got %v", err)
	}

	conn, err := dialGuarded(ctx, "127.0.0.1", port, true)
	if err != nil {
		t.Fatalf("allowed dial failed: %v", err)
	}
	conn.Close()
}

func TestSecretBox(t *testing.T) {
	dir := t.TempDir()
	box, err := loadSecretBox(dir)
	if err != nil {
		t.Fatalf("loadSecretBox: %v", err)
	}
	sealed, err := box.Seal("app password")
	if err != nil || sealed == "" || sealed == "app password" {
		t.Fatalf("Seal = %q, %v", sealed, err)
	}
	opened, err := box.Open(sealed)
	if err != nil || opened != "app password" {
		t.Fatalf("Open = %q, %v", opened, err)
	}

	//The key persists across restarts
	again, err := loadSecretBox(dir)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if opened, err := again.Open(sealed); err != nil || opened != "app password" {
		t.Errorf("reloaded box cannot open: %q %v", opened, err)
	}
	if info, err := os.Stat(filepath.Join(dir, keyFileName)); err != nil || info.Size() == 0 {
		t.Errorf("key file missing: %v", err)
	}

	tampered := []byte(sealed)
	tampered[len(tampered)-2] ^= 1
	if _, err := box.Open(string(tampered)); err == nil {
		t.Errorf("tampered ciphertext was accepted")
	}
	if empty, err := box.Seal(""); err != nil || empty != "" {
		t.Errorf("empty secret should seal to empty, got %q %v", empty, err)
	}
}

func TestUserSettingsNormalise(t *testing.T) {
	settings := UserSettings{
		Theme: "neon", Density: "tiny", MarkReadDelay: 999, RemoteImages: "never",
		TrustedSenders:  []string{" News@Shop.test ", "news@shop.test", "", "@bank.test"},
		UndoSendSeconds: -4, PollMinutes: 0, PageSize: 5000, SendShortcut: "x",
	}
	settings.normalise()
	defaults := DefaultUserSettings()
	if settings.Theme != defaults.Theme || settings.Density != defaults.Density || settings.MarkReadDelay != defaults.MarkReadDelay {
		t.Errorf("invalid values were not reset: %+v", settings)
	}
	if len(settings.TrustedSenders) != 2 {
		t.Errorf("trusted senders not cleaned: %v", settings.TrustedSenders)
	}
	if !settings.IsTrustedSender("NEWS@shop.test") || !settings.IsTrustedSender("alerts@bank.test") || settings.IsTrustedSender("x@other.test") {
		t.Errorf("IsTrustedSender gave wrong answers")
	}
}

func TestXOAuth2Client(t *testing.T) {
	client := newXOAuth2Client("me@example.test", "token123")
	mechanism, response, err := client.Start()
	if err != nil || mechanism != "XOAUTH2" {
		t.Fatalf("Start = %s, %v", mechanism, err)
	}
	if string(response) != "user=me@example.test\x01auth=Bearer token123\x01\x01" {
		t.Errorf("initial response = %q", response)
	}
	reply, err := client.Next([]byte(`{"status":"401","schemes":"Bearer","scope":"https://mail.google.com/"}`))
	if err != nil || len(reply) != 0 {
		t.Errorf("Next should answer an empty response, got %q %v", reply, err)
	}
}

func TestLooksLikeAuthFailure(t *testing.T) {
	tests := map[string]bool{
		"[AUTHENTICATIONFAILED] Invalid credentials (Failure)":    true,
		"535 5.7.8 Username and Password not accepted":            true,
		"Application-specific password required":                  true,
		"[UNAVAILABLE] Temporary failure, please try again later": false,
		"mailbox is full": false,
	}
	for message, want := range tests {
		if got := looksLikeAuthFailure(message); got != want {
			t.Errorf("looksLikeAuthFailure(%q) = %v, want %v", message, got, want)
		}
	}
}

func TestPoolReusesAndInvalidates(t *testing.T) {
	manager := newTestManager(t)
	account, imapServer, _ := addTestAccount(t, manager)
	imapServer.appendRaw(t, "INBOX", sampleMessage("Pool", "Bob <bob@example.test>", "x"))
	key := poolKey(testAdmin.Username, account.ID)

	for i := 0; i < 3; i++ {
		if _, err := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{}); err != nil {
			t.Fatalf("ListMessages: %v", err)
		}
	}
	if idle := manager.pool.idleCount(key); idle != 1 {
		t.Errorf("sequential calls should share one connection, idle = %d", idle)
	}
	manager.pool.invalidate(key)
	if idle := manager.pool.idleCount(key); idle != 0 {
		t.Errorf("invalidate left %d idle connections", idle)
	}
	if _, err := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{}); err != nil {
		t.Fatalf("ListMessages after invalidate: %v", err)
	}
}
