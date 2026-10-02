package email

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/emersion/go-imap/v2"
	gomessage "github.com/emersion/go-message"
)

const htmlMessageWithAttachment = `From: Synology <noreply@synology.test>
To: Alice <alice@example.test>
Subject: =?utf-8?B?UmU6IEFyb3pPUyDmlbTlkIg=?=
Date: Tue, 03 Mar 2026 09:00:00 +0000
Message-ID: <proposal@synology.test>
List-Unsubscribe: <mailto:leave@synology.test>, <https://synology.test/unsub>
Authentication-Results: mx.example.test; spf=pass smtp.mailfrom=synology.test; dkim=pass header.d=synology.test; dmarc=pass
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="outer"

--outer
Content-Type: multipart/alternative; boundary="alt"

--alt
Content-Type: text/plain; charset=utf-8

Hi Toby, thanks for the proposal.
--alt
Content-Type: multipart/related; boundary="rel"

--rel
Content-Type: text/html; charset=utf-8

<html><body><p onclick="steal()">Hi Toby, thanks for the proposal.</p><img src="cid:logo@synology.test"><img src="https://tracker.test/pixel.gif"><script>alert(1)</script></body></html>
--rel
Content-Type: image/png
Content-ID: <logo@synology.test>
Content-Transfer-Encoding: base64

iVBORw0KGgo=
--rel--
--alt--
--outer
Content-Type: application/pdf; name="proposal.pdf"
Content-Disposition: attachment; filename="proposal.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQKJcfsj6IK
--outer--
`

func TestAddAccountVerifiesCredentials(t *testing.T) {
	manager := newTestManager(t)
	imapServer := startIMAPServer(t, nil)
	smtpServer := startSMTPServer(t)

	_, result, err := manager.AddAccount(testContext(t), testAdmin, testAccountInput(imapServer, smtpServer, "wrong password"))
	if err == nil {
		t.Fatalf("AddAccount accepted a wrong password")
	}
	if !result.AuthFailed || result.Stage != "imap" {
		t.Errorf("expected an IMAP auth failure, got %+v", result)
	}

	info, result, err := manager.AddAccount(testContext(t), testAdmin, testAccountInput(imapServer, smtpServer, testMailPassword))
	if err != nil {
		t.Fatalf("AddAccount: %v", err)
	}
	if !result.IMAPOK || !result.SMTPOK {
		t.Errorf("expected both servers verified, got %+v", result)
	}
	if !info.HasSecret || info.Email != testMailUser {
		t.Errorf("unexpected account info %+v", info)
	}

	accounts, err := manager.ListAccounts(testAdmin)
	if err != nil || len(accounts) != 1 {
		t.Fatalf("ListAccounts = %v, %v", accounts, err)
	}

	//The same mailbox cannot be added twice
	if _, _, err := manager.AddAccount(testContext(t), testAdmin, testAccountInput(imapServer, smtpServer, testMailPassword)); err == nil {
		t.Errorf("duplicate account was accepted")
	}

	//Secrets are sealed at rest
	stored, err := manager.store.getAccount(testAdmin.Username, info.ID)
	if err != nil {
		t.Fatalf("getAccount: %v", err)
	}
	if strings.Contains(stored.Secret, testMailPassword) || stored.Secret == "" {
		t.Errorf("password is not sealed: %q", stored.Secret)
	}
}

func TestNonAdminCannotReachLocalServers(t *testing.T) {
	manager := newTestManager(t)
	imapServer := startIMAPServer(t, nil)
	smtpServer := startSMTPServer(t)
	user := Principal{Username: "bob"}

	input := testAccountInput(imapServer, smtpServer, testMailPassword)
	if _, _, err := manager.AddAccount(testContext(t), user, input); !errors.Is(err, ErrInsecureBlocked) {
		t.Fatalf("expected ErrInsecureBlocked, got %v", err)
	}

	if err := manager.SetAdminConfig(testAdmin, AdminConfigInput{AllowInsecure: true}); err != nil {
		t.Fatalf("SetAdminConfig: %v", err)
	}
	if _, _, err := manager.AddAccount(testContext(t), user, input); err == nil || !strings.Contains(err.Error(), ErrBlockedAddress.Error()) {
		t.Fatalf("expected the loopback address to be blocked, got %v", err)
	}

	if err := manager.SetAdminConfig(testAdmin, AdminConfigInput{AllowInsecure: true, AllowPrivateHosts: true}); err != nil {
		t.Fatalf("SetAdminConfig: %v", err)
	}
	if _, _, err := manager.AddAccount(testContext(t), user, input); err != nil {
		t.Fatalf("AddAccount after the admin allowed LAN servers: %v", err)
	}
}

func TestFoldersDetectRoles(t *testing.T) {
	manager := newTestManager(t)
	account, _, _ := addTestAccount(t, manager)

	folders, err := manager.Folders(testContext(t), testAdmin, account.ID, true)
	if err != nil {
		t.Fatalf("Folders: %v", err)
	}
	roles := map[string]string{}
	for _, folder := range folders {
		roles[folder.Name] = folder.Role
	}
	expected := map[string]string{"INBOX": RoleInbox, "Sent": RoleSent, "Drafts": RoleDrafts, "Trash": RoleTrash, "Junk": RoleJunk, "Projects": ""}
	for name, role := range expected {
		if got, ok := roles[name]; !ok || got != role {
			t.Errorf("folder %s: role %q, want %q", name, got, role)
		}
	}
	if folders[0].Name != "INBOX" {
		t.Errorf("INBOX should be listed first, got %s", folders[0].Name)
	}
}

func TestFoldersWithoutListStatus(t *testing.T) {
	manager := newTestManager(t)
	imapServer := startIMAPServer(t, imap.CapSet{imap.CapIMAP4rev1: {}})
	smtpServer := startSMTPServer(t)
	imapServer.appendRaw(t, "INBOX", sampleMessage("Counted", "Bob <bob@example.test>", "hello"))
	account, _, err := manager.AddAccount(testContext(t), testAdmin, testAccountInput(imapServer, smtpServer, testMailPassword))
	if err != nil {
		t.Fatalf("AddAccount: %v", err)
	}
	folders, err := manager.Folders(testContext(t), testAdmin, account.ID, true)
	if err != nil {
		t.Fatalf("Folders: %v", err)
	}
	for _, folder := range folders {
		if folder.Name == "INBOX" && (folder.Total != 1 || folder.Unread != 1) {
			t.Errorf("INBOX counts = %d/%d, want 1/1", folder.Unread, folder.Total)
		}
	}
}

func TestListMessagesPagingAndFilters(t *testing.T) {
	manager := newTestManager(t)
	account, imapServer, _ := addTestAccount(t, manager)
	for i := 1; i <= 7; i++ {
		var flags []imap.Flag
		if i%2 == 0 {
			flags = append(flags, imap.FlagSeen)
		}
		imapServer.appendRaw(t, "INBOX", sampleMessage("Message "+itoa(i), "Bob <bob@example.test>", "Body of message "+itoa(i)), flags...)
	}

	page, err := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{Folder: "INBOX", PageSize: 3, Previews: true})
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if page.Total != 7 || len(page.Messages) != 3 {
		t.Fatalf("page 0: total %d len %d", page.Total, len(page.Messages))
	}
	if page.Messages[0].Subject != "Message 7" {
		t.Errorf("newest first expected, got %q", page.Messages[0].Subject)
	}
	if page.Messages[0].Preview != "Body of message 7" {
		t.Errorf("preview = %q", page.Messages[0].Preview)
	}

	last, err := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{Folder: "INBOX", PageSize: 3, Page: 2})
	if err != nil {
		t.Fatalf("ListMessages page 2: %v", err)
	}
	if len(last.Messages) != 1 || last.Messages[0].Subject != "Message 1" {
		t.Errorf("last page = %+v", last.Messages)
	}

	unread, err := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{Folder: "INBOX", Filter: "unread"})
	if err != nil {
		t.Fatalf("ListMessages unread: %v", err)
	}
	if unread.Total != 4 {
		t.Errorf("unread total = %d, want 4", unread.Total)
	}

	search, err := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{Folder: "INBOX", Search: "message 5", SearchIn: "subject"})
	if err != nil {
		t.Fatalf("ListMessages search: %v", err)
	}
	if search.Total != 1 || search.Messages[0].Subject != "Message 5" {
		t.Errorf("search result = %+v", search.Messages)
	}

	bySubject, err := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{Folder: "INBOX", Sort: "subject"})
	if err != nil {
		t.Fatalf("ListMessages sort: %v", err)
	}
	if bySubject.Messages[0].Subject != "Message 1" {
		t.Errorf("subject sort starts with %q", bySubject.Messages[0].Subject)
	}
}

func TestGetMessageSanitisesAndMarksSeen(t *testing.T) {
	manager := newTestManager(t)
	account, imapServer, _ := addTestAccount(t, manager)
	imapServer.appendRaw(t, "INBOX", htmlMessageWithAttachment)

	list, err := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{Folder: "INBOX"})
	if err != nil || len(list.Messages) != 1 {
		t.Fatalf("ListMessages: %v %+v", err, list)
	}
	summary := list.Messages[0]
	if !summary.HasAttachments {
		t.Errorf("list should report the PDF attachment")
	}
	if summary.Subject != "Re: ArozOS 整合" {
		t.Errorf("encoded subject decoded to %q", summary.Subject)
	}

	message, err := manager.GetMessage(testContext(t), testAdmin, account.ID, "INBOX", summary.UID, GetOptions{MarkSeen: true})
	if err != nil {
		t.Fatalf("GetMessage: %v", err)
	}
	for _, forbidden := range []string{"<script", "onclick", "https://tracker.test/pixel.gif\""} {
		if strings.Contains(message.HTML, forbidden) && !strings.Contains(message.HTML, "data-remote-src=\"https://tracker.test/pixel.gif\"") {
			t.Errorf("sanitised HTML still contains %q: %s", forbidden, message.HTML)
		}
	}
	if !strings.Contains(message.HTML, "data:image/png;base64,iVBORw0KGgo=") {
		t.Errorf("inline image was not resolved: %s", message.HTML)
	}
	if !message.HasRemoteContent || message.RemoteAllowed {
		t.Errorf("remote content flags wrong: has=%v allowed=%v", message.HasRemoteContent, message.RemoteAllowed)
	}
	if len(message.Attachments) != 1 || message.Attachments[0].Filename != "proposal.pdf" {
		t.Fatalf("attachments = %+v", message.Attachments)
	}
	if message.ListUnsubscribe != "https://synology.test/unsub" {
		t.Errorf("unsubscribe = %q", message.ListUnsubscribe)
	}
	if message.Auth == nil || message.Auth.SPF != "pass" || message.Auth.DKIM != "pass" || message.Auth.DMARC != "pass" {
		t.Errorf("auth results = %+v", message.Auth)
	}
	if !message.Seen {
		t.Errorf("message should be marked seen")
	}
	//The flag must reach the server, not just the response
	relisted, err := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{Folder: "INBOX"})
	if err != nil || len(relisted.Messages) != 1 || !relisted.Messages[0].Seen {
		t.Errorf("seen flag was not stored on the server: %+v %v", relisted, err)
	}
	statuses, _ := manager.CheckInboxes(testContext(t), testAdmin)
	if len(statuses) != 1 || statuses[0].Unread != 0 {
		t.Errorf("STATUS still counts the message as unread: %+v", statuses)
	}

	part, err := manager.GetPart(testContext(t), testAdmin, account.ID, "INBOX", summary.UID, message.Attachments[0].ID)
	if err != nil {
		t.Fatalf("GetPart: %v", err)
	}
	if !bytes.HasPrefix(part.Data, []byte("%PDF-1.4")) || part.Filename != "proposal.pdf" {
		t.Errorf("attachment content = %q (%s)", part.Data, part.Filename)
	}

	remote, err := manager.GetMessage(testContext(t), testAdmin, account.ID, "INBOX", summary.UID, GetOptions{AllowRemote: true})
	if err != nil {
		t.Fatalf("GetMessage allowRemote: %v", err)
	}
	if !strings.Contains(remote.HTML, `src="https://tracker.test/pixel.gif"`) {
		t.Errorf("remote image should load when allowed: %s", remote.HTML)
	}

	raw, err := manager.GetRaw(testContext(t), testAdmin, account.ID, "INBOX", summary.UID)
	if err != nil {
		t.Fatalf("GetRaw: %v", err)
	}
	if !strings.HasSuffix(raw.Filename, ".eml") || !bytes.Contains(raw.Data, []byte("proposal.pdf")) {
		t.Errorf("raw message = %s / %d bytes", raw.Filename, len(raw.Data))
	}
}

func TestFlagsMoveAndDelete(t *testing.T) {
	manager := newTestManager(t)
	account, imapServer, _ := addTestAccount(t, manager)
	imapServer.appendRaw(t, "INBOX", sampleMessage("Keep", "Bob <bob@example.test>", "keep"))
	imapServer.appendRaw(t, "INBOX", sampleMessage("Remove", "Bob <bob@example.test>", "remove"))

	list, _ := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{Folder: "INBOX"})
	keep, remove := list.Messages[1], list.Messages[0]

	if _, err := manager.SetFlag(testContext(t), testAdmin, account.ID, "INBOX", []uint32{keep.UID}, "flagged", true); err != nil {
		t.Fatalf("SetFlag: %v", err)
	}
	flagged, _ := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{Folder: "INBOX", Filter: "flagged"})
	if flagged.Total != 1 || flagged.Messages[0].Subject != "Keep" {
		t.Errorf("flagged filter = %+v", flagged.Messages)
	}

	result, err := manager.Delete(testContext(t), testAdmin, account.ID, "INBOX", []uint32{remove.UID}, false)
	if err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if result.Permanent || result.Destination != "Trash" {
		t.Errorf("delete should move to Trash, got %+v", result)
	}
	trash, _ := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{Folder: "Trash"})
	if trash.Total != 1 {
		t.Fatalf("Trash has %d messages", trash.Total)
	}

	result, err = manager.Delete(testContext(t), testAdmin, account.ID, "Trash", []uint32{trash.Messages[0].UID}, false)
	if err != nil {
		t.Fatalf("Delete from Trash: %v", err)
	}
	if !result.Permanent {
		t.Errorf("delete inside Trash should be permanent")
	}
	trash, _ = manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{Folder: "Trash"})
	if trash.Total != 0 {
		t.Errorf("Trash still has %d messages", trash.Total)
	}

	moved, err := manager.MoveToRole(testContext(t), testAdmin, account.ID, "INBOX", []uint32{keep.UID}, RoleArchive)
	if err != nil {
		t.Fatalf("archive: %v", err)
	}
	if moved.Destination != "Archive" {
		t.Errorf("archive should create the Archive folder, got %q", moved.Destination)
	}
	inbox, _ := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{Folder: "INBOX"})
	if inbox.Total != 0 {
		t.Errorf("INBOX should be empty, has %d", inbox.Total)
	}
}

func TestMoveFallsBackWithoutMoveCapability(t *testing.T) {
	manager := newTestManager(t)
	imapServer := startIMAPServer(t, imap.CapSet{imap.CapIMAP4rev1: {}, imap.CapUIDPlus: {}})
	smtpServer := startSMTPServer(t)
	imapServer.appendRaw(t, "INBOX", sampleMessage("Moving", "Bob <bob@example.test>", "x"))
	account, _, err := manager.AddAccount(testContext(t), testAdmin, testAccountInput(imapServer, smtpServer, testMailPassword))
	if err != nil {
		t.Fatalf("AddAccount: %v", err)
	}
	list, _ := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{Folder: "INBOX"})
	if _, err := manager.Move(testContext(t), testAdmin, account.ID, "INBOX", []uint32{list.Messages[0].UID}, "Projects"); err != nil {
		t.Fatalf("Move: %v", err)
	}
	projects, _ := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{Folder: "Projects"})
	inbox, _ := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{Folder: "INBOX"})
	if projects.Total != 1 || inbox.Total != 0 {
		t.Errorf("after move: Projects %d, INBOX %d", projects.Total, inbox.Total)
	}
}

func TestSendDeliversAndFilesSentCopy(t *testing.T) {
	manager := newTestManager(t)
	account, _, smtpServer := addTestAccount(t, manager)

	result, err := manager.Send(testContext(t), testAdmin, &ComposeRequest{
		AccountID: account.ID,
		To:        []string{"Bob <bob@example.test>"},
		Bcc:       []string{"secret@example.test"},
		Subject:   "Quarterly report",
		HTML:      "<p>Hello <b>Bob</b></p>",
		Attachments: []ComposeAttachment{
			{Name: "report.csv", Data: []byte("a,b\n1,2\n")},
		},
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if result.Queued || result.Warning != "" {
		t.Errorf("unexpected send result %+v", result)
	}

	received := smtpServer.received()
	if len(received) != 1 {
		t.Fatalf("SMTP received %d messages", len(received))
	}
	if strings.Join(received[0].to, ",") != "bob@example.test,secret@example.test" {
		t.Errorf("recipients = %v", received[0].to)
	}
	if bytes.Contains(received[0].data, []byte("secret@example.test")) {
		t.Errorf("Bcc leaked into the delivered message")
	}

	sent, err := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{Folder: "Sent"})
	if err != nil || sent.Total != 1 {
		t.Fatalf("Sent folder: %v %+v", err, sent)
	}
	copyMessage, err := manager.GetMessage(testContext(t), testAdmin, account.ID, "Sent", sent.Messages[0].UID, GetOptions{})
	if err != nil {
		t.Fatalf("GetMessage sent copy: %v", err)
	}
	if len(copyMessage.Bcc) != 1 || copyMessage.Bcc[0].Email != "secret@example.test" {
		t.Errorf("Sent copy should keep Bcc, got %+v", copyMessage.Bcc)
	}
	if len(copyMessage.Attachments) != 1 || copyMessage.Attachments[0].Filename != "report.csv" {
		t.Errorf("Sent copy attachments = %+v", copyMessage.Attachments)
	}

	contacts, _ := manager.SearchContacts(testAdmin, "bo", 5)
	if len(contacts) != 1 || contacts[0].Email != "bob@example.test" || contacts[0].Name != "Bob" {
		t.Errorf("recipient was not collected: %+v", contacts)
	}
}

func TestDraftsAreReplaced(t *testing.T) {
	manager := newTestManager(t)
	account, _, _ := addTestAccount(t, manager)

	request := &ComposeRequest{AccountID: account.ID, To: []string{"bob@example.test"}, Subject: "Draft v1", HTML: "<p>one</p>"}
	first, err := manager.SaveDraft(testContext(t), testAdmin, request)
	if err != nil {
		t.Fatalf("SaveDraft: %v", err)
	}
	if first.Folder != "Drafts" || first.UID == 0 {
		t.Fatalf("draft saved to %+v", first)
	}

	request.Subject = "Draft v2"
	request.DraftFolder = first.Folder
	request.DraftUID = first.UID
	second, err := manager.SaveDraft(testContext(t), testAdmin, request)
	if err != nil {
		t.Fatalf("SaveDraft v2: %v", err)
	}
	drafts, _ := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{Folder: "Drafts"})
	if drafts.Total != 1 || drafts.Messages[0].Subject != "Draft v2" || drafts.Messages[0].UID != second.UID {
		t.Errorf("drafts after replace = %+v", drafts.Messages)
	}
	if !drafts.Messages[0].Draft {
		t.Errorf("draft flag missing")
	}
}

func TestUndoableSendGoesThroughOutbox(t *testing.T) {
	manager := newTestManager(t)
	account, _, smtpServer := addTestAccount(t, manager)

	result, err := manager.Send(testContext(t), testAdmin, &ComposeRequest{
		AccountID: account.ID, To: []string{"bob@example.test"}, Subject: "Undo me", Text: "hi", UndoSeconds: 30,
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if !result.Queued || result.OutboxID == "" {
		t.Fatalf("expected a queued result, got %+v", result)
	}
	if _, err := manager.OutboxCancel(testContext(t), testAdmin, result.OutboxID, false); err != nil {
		t.Fatalf("OutboxCancel: %v", err)
	}
	if items, _ := manager.Outbox(testAdmin); len(items) != 0 {
		t.Errorf("outbox still has %d items", len(items))
	}

	result, err = manager.Send(testContext(t), testAdmin, &ComposeRequest{
		AccountID: account.ID, To: []string{"bob@example.test"}, Subject: "Deliver me", Text: "hi", UndoSeconds: 30,
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if err := manager.OutboxSendNow(testAdmin, result.OutboxID); err != nil {
		t.Fatalf("OutboxSendNow: %v", err)
	}
	manager.outbox.processDue(testContext(t))
	if received := smtpServer.received(); len(received) != 1 || !bytes.Contains(received[0].data, []byte("Deliver me")) {
		t.Fatalf("outbox did not deliver, SMTP got %d messages", len(received))
	}
	if items, _ := manager.Outbox(testAdmin); len(items) != 0 {
		t.Errorf("delivered item still in the outbox")
	}
}

func TestUnifiedInboxMergesAccounts(t *testing.T) {
	manager := newTestManager(t)
	first, firstServer, _ := addTestAccount(t, manager)

	//The same address on the same host counts as a duplicate, so the second
	//test server is addressed by name
	secondServer := startIMAPServer(t, nil)
	secondSMTP := startSMTPServer(t)
	input := testAccountInput(secondServer, secondSMTP, testMailPassword)
	input.DisplayName = "Alice Work"
	input.IMAP.Host = "localhost"
	input.SMTP.Host = "localhost"
	secondInfo, _, err := manager.AddAccount(testContext(t), testAdmin, input)
	if err != nil {
		t.Fatalf("AddAccount second: %v", err)
	}

	now := time.Now()
	firstServer.appendRawAt(t, "INBOX", sampleMessage("From first", "Bob <bob@example.test>", "a"), now.Add(-time.Hour))
	secondServer.appendRawAt(t, "INBOX", sampleMessage("From second", "Carol <carol@example.test>", "b"), now)

	merged, err := manager.UnifiedList(testContext(t), testAdmin, ViewInbox, nil, ListQuery{})
	if err != nil {
		t.Fatalf("UnifiedList: %v", err)
	}
	if merged.Total != 2 || len(merged.Messages) != 2 {
		t.Fatalf("merged = %+v", merged)
	}
	if merged.Messages[0].AccountID != secondInfo.ID || merged.Messages[1].AccountID != first.ID {
		t.Errorf("messages are not ordered by arrival across accounts")
	}

	statuses, err := manager.CheckInboxes(testContext(t), testAdmin)
	if err != nil || len(statuses) != 2 {
		t.Fatalf("CheckInboxes: %v %+v", err, statuses)
	}
	for _, status := range statuses {
		if status.Unread != 1 || status.UIDNext == 0 {
			t.Errorf("status = %+v", status)
		}
	}
}

func TestImportAndParseEML(t *testing.T) {
	manager := newTestManager(t)
	account, _, _ := addTestAccount(t, manager)
	raw := []byte(strings.ReplaceAll(htmlMessageWithAttachment, "\n", "\r\n"))

	message, err := manager.ParseEML(testAdmin, raw, false)
	if err != nil {
		t.Fatalf("ParseEML: %v", err)
	}
	if message.Subject != "Re: ArozOS 整合" || len(message.Attachments) != 1 {
		t.Errorf("parsed eml = %q, %+v", message.Subject, message.Attachments)
	}
	part, err := EMLPart(raw, message.Attachments[0].ID)
	if err != nil || !bytes.HasPrefix(part.Data, []byte("%PDF")) {
		t.Errorf("EMLPart = %v, %q", err, part)
	}

	uid, err := manager.ImportMessage(testContext(t), testAdmin, account.ID, "Projects", raw)
	if err != nil || uid == 0 {
		t.Fatalf("ImportMessage: %v uid %d", err, uid)
	}
	imported, err := manager.GetMessage(testContext(t), testAdmin, account.ID, "Projects", uid, GetOptions{})
	if err != nil {
		t.Fatalf("GetMessage imported: %v", err)
	}
	if imported.MessageID != "proposal@synology.test" {
		t.Errorf("imported message id = %q", imported.MessageID)
	}
}

func TestComposeStructure(t *testing.T) {
	manager := newTestManager(t)
	account, _, _ := addTestAccount(t, manager)
	stored, _ := manager.store.getAccount(testAdmin.Username, account.ID)

	built, err := manager.buildMessage(testContext(t), testAdmin, stored, &ComposeRequest{
		AccountID:  account.ID,
		To:         []string{"\"Wang, Xiao\" <xiao@example.test>; bob@example.test"},
		Subject:    "會議 notes",
		HTML:       `<p>See chart</p><img src="data:image/png;base64,iVBORw0KGgo=">`,
		InReplyTo:  "<orig@example.test>",
		References: []string{"<root@example.test>"},
		Priority:   "high",
		Attachments: []ComposeAttachment{
			{Name: "報告.txt", Data: []byte("hello")},
		},
	}, false)
	if err != nil {
		t.Fatalf("buildMessage: %v", err)
	}
	if len(built.recipients) != 2 {
		t.Errorf("recipients = %v", built.recipients)
	}

	entity, err := gomessage.Read(bytes.NewReader(built.raw))
	if err != nil {
		t.Fatalf("generated message does not parse: %v", err)
	}
	tree := treeFromEntity(entity)
	parts := selectDisplayParts(tree)
	if parts.html == nil || parts.text == nil {
		t.Fatalf("expected html and text parts")
	}
	if !strings.Contains(string(parts.html.body), "cid:img1.") {
		t.Errorf("pasted image was not converted to a cid reference: %s", parts.html.body)
	}
	if len(parts.inline) != 1 {
		t.Errorf("expected one inline image, got %d", len(parts.inline))
	}
	attachments := attachmentInfo(parts.attachments)
	if len(attachments) != 1 || attachments[0].Filename != "報告.txt" {
		t.Errorf("attachments = %+v", attachments)
	}

	header := parseHeaderBytes(built.raw)
	if subject, _ := header.Subject(); subject != "會議 notes" {
		t.Errorf("subject = %q", subject)
	}
	if references := header.Get("References"); !strings.Contains(references, "<root@example.test>") || !strings.Contains(references, "<orig@example.test>") {
		t.Errorf("references = %q", references)
	}
	if header.Get("X-Priority") == "" || header.Get("Importance") != "High" {
		t.Errorf("priority headers missing")
	}
}

func TestRemoveAccountClearsLocalState(t *testing.T) {
	manager := newTestManager(t)
	account, imapServer, _ := addTestAccount(t, manager)
	imapServer.appendRaw(t, "INBOX", sampleMessage("Labelled", "Bob <bob@example.test>", "x"))
	list, _ := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{Folder: "INBOX"})

	if err := manager.SetMessageLabels(testAdmin, list.Messages[0], []string{"work"}); err != nil {
		t.Fatalf("SetMessageLabels: %v", err)
	}
	if err := manager.RemoveAccount(testAdmin, account.ID); err != nil {
		t.Fatalf("RemoveAccount: %v", err)
	}
	if labelled, _ := manager.LabelMessages(testAdmin, "work"); len(labelled) != 0 {
		t.Errorf("labels of a removed account survived: %+v", labelled)
	}
	if _, err := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{}); !errors.Is(err, ErrAccountNotFound) {
		t.Errorf("expected ErrAccountNotFound, got %v", err)
	}
}
