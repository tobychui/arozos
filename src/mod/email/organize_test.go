package email

import (
	"testing"
	"time"
)

func TestLabels(t *testing.T) {
	manager := newTestManager(t)
	account, imapServer, _ := addTestAccount(t, manager)
	imapServer.appendRaw(t, "INBOX", sampleMessage("Budget", "Bob <bob@example.test>", "numbers"))

	labels := manager.Labels(testAdmin)
	if len(labels) != len(defaultLabels) {
		t.Fatalf("default labels = %+v", labels)
	}

	list, _ := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{})
	message := list.Messages[0]
	if err := manager.SetMessageLabels(testAdmin, message, []string{"work", "unknown"}); err != nil {
		t.Fatalf("SetMessageLabels: %v", err)
	}

	list, _ = manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{})
	if len(list.Messages[0].Labels) != 1 || list.Messages[0].Labels[0] != "work" {
		t.Errorf("listed labels = %v", list.Messages[0].Labels)
	}
	labelled, err := manager.LabelMessages(testAdmin, "work")
	if err != nil || len(labelled) != 1 || labelled[0].Subject != "Budget" {
		t.Fatalf("LabelMessages = %+v, %v", labelled, err)
	}

	//Labels follow a message to another folder because they key on Message-ID
	if _, err := manager.Move(testContext(t), testAdmin, account.ID, "INBOX", []uint32{message.UID}, "Projects"); err != nil {
		t.Fatalf("Move: %v", err)
	}
	moved, _ := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{Folder: "Projects"})
	if len(moved.Messages) != 1 || len(moved.Messages[0].Labels) != 1 {
		t.Errorf("label lost after move: %+v", moved.Messages)
	}
	located, err := manager.LocateMessage(testContext(t), testAdmin, account.ID, message.MessageID, "INBOX")
	if err != nil || located.Folder != "Projects" {
		t.Errorf("LocateMessage = %+v, %v", located, err)
	}

	//Deleting a label definition strips it from messages
	kept := []Label{}
	for _, label := range labels {
		if label.ID != "work" {
			kept = append(kept, label)
		}
	}
	kept = append(kept, Label{Name: "Invoices", Color: "not-a-colour"})
	saved, err := manager.SaveLabels(testAdmin, kept)
	if err != nil {
		t.Fatalf("SaveLabels: %v", err)
	}
	if last := saved[len(saved)-1]; last.ID == "" || last.Color != "#64748b" {
		t.Errorf("new label not normalised: %+v", last)
	}
	if labelled, _ := manager.LabelMessages(testAdmin, "work"); len(labelled) != 0 {
		t.Errorf("deleted label still assigned")
	}
}

func TestSnooze(t *testing.T) {
	manager := newTestManager(t)
	account, imapServer, _ := addTestAccount(t, manager)
	imapServer.appendRaw(t, "INBOX", sampleMessage("Later", "Bob <bob@example.test>", "ping"))
	list, _ := manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{})
	message := list.Messages[0]

	if err := manager.Snooze(testAdmin, message, time.Now().Add(-time.Minute).UnixMilli()); err == nil {
		t.Errorf("a snooze in the past was accepted")
	}
	until := time.Now().Add(time.Hour).UnixMilli()
	if err := manager.Snooze(testAdmin, message, until); err != nil {
		t.Fatalf("Snooze: %v", err)
	}
	list, _ = manager.ListMessages(testContext(t), testAdmin, account.ID, ListQuery{})
	if list.Messages[0].SnoozedUntil != until {
		t.Errorf("snooze not reported in the list: %d", list.Messages[0].SnoozedUntil)
	}
	snoozed, _ := manager.SnoozedMessages(testAdmin)
	if len(snoozed) != 1 || snoozed[0].Subject != "Later" {
		t.Fatalf("SnoozedMessages = %+v", snoozed)
	}

	if err := manager.Unsnooze(testAdmin, message); err != nil {
		t.Fatalf("Unsnooze: %v", err)
	}
	if snoozed, _ := manager.SnoozedMessages(testAdmin); len(snoozed) != 0 {
		t.Errorf("message still snoozed")
	}

	//An expired snooze is woken by the next poll
	dbKey := ownerKey(testAdmin.Username, summaryKey(message))
	manager.store.db.Write(tableSnooze, dbKey, localMessage{Key: summaryKey(message), Until: time.Now().Add(-time.Second).UnixMilli(), Summary: message})
	if _, err := manager.CheckInboxes(testContext(t), testAdmin); err != nil {
		t.Fatalf("CheckInboxes: %v", err)
	}
	if manager.store.db.KeyExists(tableSnooze, dbKey) {
		t.Errorf("expired snooze was not woken")
	}
}

func TestContacts(t *testing.T) {
	manager := newTestManager(t)
	manager.collectContacts(testAdmin, []Address{
		{Name: "Bob Builder", Email: "bob@example.test"},
		{Email: "bobby@other.test"},
		{Name: "Carol", Email: "carol@example.test"},
	})
	manager.collectContacts(testAdmin, []Address{{Email: "bobby@other.test"}})

	results, err := manager.SearchContacts(testAdmin, "bob", 5)
	if err != nil || len(results) != 2 {
		t.Fatalf("SearchContacts = %+v, %v", results, err)
	}
	if results[0].Email != "bobby@other.test" || results[0].Count != 2 {
		t.Errorf("the most used address should rank first: %+v", results)
	}
	if byWord, _ := manager.SearchContacts(testAdmin, "builder", 5); len(byWord) != 1 {
		t.Errorf("word prefix search failed: %+v", byWord)
	}

	if _, err := manager.SaveContact(testAdmin, Contact{Email: "not an address"}); err == nil {
		t.Errorf("an invalid address was saved")
	}
	saved, err := manager.SaveContact(testAdmin, Contact{Email: "carol@example.test", Name: "Carol Danvers", Company: "Avengers"})
	if err != nil || !saved.Manual || saved.Count != 1 {
		t.Errorf("SaveContact = %+v, %v", saved, err)
	}
	if err := manager.DeleteContact(testAdmin, "CAROL@example.test"); err != nil {
		t.Fatalf("DeleteContact: %v", err)
	}
	all, _ := manager.Contacts(testAdmin)
	if len(all) != 2 {
		t.Errorf("contacts after delete = %+v", all)
	}

	//Address books are private to their owner
	if others, _ := manager.Contacts(Principal{Username: "eve"}); len(others) != 0 {
		t.Errorf("another user can see the address book")
	}
}

func TestSettingsRoundTrip(t *testing.T) {
	manager := newTestManager(t)
	settings := manager.Settings(testAdmin)
	settings.Density = "compact"
	settings.UndoSendSeconds = 10
	if _, err := manager.SaveSettings(testAdmin, settings); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}
	if err := manager.TrustSender(testAdmin, "News@Shop.test"); err != nil {
		t.Fatalf("TrustSender: %v", err)
	}
	loaded := manager.Settings(testAdmin)
	if loaded.Density != "compact" || loaded.UndoSendSeconds != 10 || !loaded.IsTrustedSender("news@shop.test") {
		t.Errorf("settings = %+v", loaded)
	}
	if other := manager.Settings(Principal{Username: "bob"}); other.Density != "comfortable" {
		t.Errorf("settings leaked between users")
	}
}
