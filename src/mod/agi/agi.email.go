package agi

/*
	AGI Email Library
	Author: tobychui

	Gives AGI scripts a full mail client backed by mod/email: IMAP accounts
	(Gmail, Outlook / Hotmail / Microsoft 365, Yahoo, iCloud and any IMAP/SMTP
	server), folders, reading, searching, flags, moving, drafts, sending with
	undo / scheduling, address book, labels, snoozing and OAuth sign-in.

	Usage (from an AGI script):
		requirelib("email");
		var accounts = email.listAccounts();
		if (accounts.success) {
			var page = email.list(accounts.data[0].id, {folder: "INBOX", page: 0});
		}

	Every function returns an object. On success it is {success: true, data: …};
	on failure {success: false, error: "…"} plus, where it applies,
	authFailed (the stored password / sign-in was rejected), hint (what the
	user should do, e.g. "use an app password") and code (notfound, blocked,
	toolarge).

	Accounts belong to the calling ArozOS user and are never visible to other
	users. Paths (attachments to send, folders to save into, .eml files) are
	ArozOS virtual paths and are permission and quota checked.
*/

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/email"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
	user "imuslab.com/arozos/mod/user"
)

const (
	emailReadTimeout = 2 * time.Minute
	emailSendTimeout = 10 * time.Minute
	emailMaxEMLBytes = 100 * 1024 * 1024
	emailTempRoot    = "tmp:/Mail"
	emailTempMaxAge  = 24 * time.Hour
)

var (
	emailTempCleanMutex sync.Mutex
	emailTempCleaned    = map[string]time.Time{}
)

func (g *Gateway) EmailLibRegister() {
	err := g.RegisterLib("email", g.injectEmailLibFunctions)
	if err != nil {
		logger.PrintAndLog("Agi", fmt.Sprint(err), nil)
		os.Exit(1)
	}
}

// emailComposeInput is the composer payload: a ComposeRequest plus files
// from the user's file system.
type emailComposeInput struct {
	email.ComposeRequest
	Files []struct {
		Path string `json:"path"`
		Name string `json:"name"`
	} `json:"files"`
}

func (g *Gateway) injectEmailLibFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	u := payload.User
	manager := g.Option.EmailManager
	principal := email.Principal{Username: u.Username, Admin: u.IsAdmin()}

	requestContext := func(timeout time.Duration) (context.Context, context.CancelFunc) {
		parent := context.Background()
		if payload.Request != nil {
			parent = payload.Request.Context()
		}
		return context.WithTimeout(parent, timeout)
	}
	//Sending must finish even if the browser gives up waiting
	detachedContext := func(timeout time.Duration) (context.Context, context.CancelFunc) {
		return context.WithTimeout(context.Background(), timeout)
	}

	ok := func(data interface{}) otto.Value { return emailResponse(vm, data, nil) }
	fail := func(err error) otto.Value { return emailResponse(vm, nil, err) }
	result := func(data interface{}, err error) otto.Value { return emailResponse(vm, data, err) }

	argString := func(call otto.FunctionCall, index int) string {
		value := call.Argument(index)
		if value.IsUndefined() || value.IsNull() {
			return ""
		}
		text, _ := value.ToString()
		return text
	}
	argUint := func(call otto.FunctionCall, index int) uint32 {
		value, err := call.Argument(index).ToInteger()
		if err != nil || value < 0 || value > int64(^uint32(0)) {
			return 0
		}
		return uint32(value)
	}
	argBool := func(call otto.FunctionCall, index int) bool {
		value, _ := call.Argument(index).ToBoolean()
		return value
	}
	argJSON := func(call otto.FunctionCall, index int, target interface{}) error {
		raw := argString(call, index)
		if raw == "" || raw == "undefined" {
			return nil
		}
		return json.Unmarshal([]byte(raw), target)
	}

	//Every call needs the backend; scripts get a clear answer when it is off
	guard := func(fn func(call otto.FunctionCall) otto.Value) func(call otto.FunctionCall) otto.Value {
		return func(call otto.FunctionCall) otto.Value {
			if manager == nil {
				return fail(errors.New("mail support is not enabled on this system"))
			}
			return fn(call)
		}
	}
	set := func(name string, fn func(call otto.FunctionCall) otto.Value) {
		vm.Set("_email_"+name, guard(fn))
	}

	/*
		Providers, discovery and OAuth
	*/

	set("providers", func(call otto.FunctionCall) otto.Value {
		return ok(email.Presets())
	})

	set("discover", func(call otto.FunctionCall) otto.Value {
		ctx, cancel := requestContext(30 * time.Second)
		defer cancel()
		return result(manager.Discover(ctx, principal, argString(call, 0)))
	})

	set("oauthproviders", func(call otto.FunctionCall) otto.Value {
		return ok(manager.OAuthProviders())
	})

	set("oauthstart", func(call otto.FunctionCall) otto.Value {
		ctx, cancel := requestContext(30 * time.Second)
		defer cancel()
		return result(manager.OAuthStart(ctx, principal, argString(call, 0), argString(call, 1), argString(call, 2)))
	})

	set("oauthcomplete", func(call otto.FunctionCall) otto.Value {
		ctx, cancel := requestContext(45 * time.Second)
		defer cancel()
		return result(manager.OAuthComplete(ctx, principal, argString(call, 0), argString(call, 1)))
	})

	set("oauthstatus", func(call otto.FunctionCall) otto.Value {
		return result(manager.OAuthStatusOf(principal, argString(call, 0)))
	})

	set("oauthcancel", func(call otto.FunctionCall) otto.Value {
		manager.OAuthCancel(principal, argString(call, 0))
		return ok(true)
	})

	/*
		Accounts
	*/

	set("listaccounts", func(call otto.FunctionCall) otto.Value {
		return result(manager.ListAccounts(principal))
	})

	set("getaccount", func(call otto.FunctionCall) otto.Value {
		return result(manager.GetAccount(principal, argString(call, 0)))
	})

	set("testaccount", func(call otto.FunctionCall) otto.Value {
		input := email.AccountInput{}
		if err := argJSON(call, 0, &input); err != nil {
			return fail(err)
		}
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		test := manager.TestAccount(ctx, principal, input)
		if test.Error != "" {
			return emailFailureWith(vm, errors.New(test.Error), map[string]interface{}{
				"test": test, "authFailed": test.AuthFailed, "hint": test.Hint,
			})
		}
		return ok(test)
	})

	set("addaccount", func(call otto.FunctionCall) otto.Value {
		input := email.AccountInput{}
		if err := argJSON(call, 0, &input); err != nil {
			return fail(err)
		}
		ctx, cancel := detachedContext(emailReadTimeout)
		defer cancel()
		info, test, err := manager.AddAccount(ctx, principal, input)
		if err != nil {
			return emailFailureWith(vm, err, map[string]interface{}{
				"test": test, "authFailed": test.AuthFailed || email.IsAuthError(err), "hint": test.Hint,
			})
		}
		return ok(map[string]interface{}{"account": info, "test": test})
	})

	set("updateaccount", func(call otto.FunctionCall) otto.Value {
		input := email.AccountInput{}
		if err := argJSON(call, 1, &input); err != nil {
			return fail(err)
		}
		ctx, cancel := detachedContext(emailReadTimeout)
		defer cancel()
		info, test, err := manager.UpdateAccount(ctx, principal, argString(call, 0), input)
		if err != nil {
			return emailFailureWith(vm, err, map[string]interface{}{
				"test": test, "authFailed": test.AuthFailed || email.IsAuthError(err), "hint": test.Hint,
			})
		}
		return ok(map[string]interface{}{"account": info, "test": test})
	})

	set("removeaccount", func(call otto.FunctionCall) otto.Value {
		return result(true, manager.RemoveAccount(principal, argString(call, 0)))
	})

	set("reorderaccounts", func(call otto.FunctionCall) otto.Value {
		ids := []string{}
		if err := argJSON(call, 0, &ids); err != nil {
			return fail(err)
		}
		return result(true, manager.ReorderAccounts(principal, ids))
	})

	/*
		Folders
	*/

	set("folders", func(call otto.FunctionCall) otto.Value {
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		return result(manager.Folders(ctx, principal, argString(call, 0), argBool(call, 1)))
	})

	set("createfolder", func(call otto.FunctionCall) otto.Value {
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		return result(manager.CreateFolder(ctx, principal, argString(call, 0), argString(call, 1), argString(call, 2)))
	})

	set("renamefolder", func(call otto.FunctionCall) otto.Value {
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		return result(manager.RenameFolder(ctx, principal, argString(call, 0), argString(call, 1), argString(call, 2)))
	})

	set("deletefolder", func(call otto.FunctionCall) otto.Value {
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		return result(true, manager.DeleteFolder(ctx, principal, argString(call, 0), argString(call, 1)))
	})

	set("emptyfolder", func(call otto.FunctionCall) otto.Value {
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		return result(manager.EmptyFolder(ctx, principal, argString(call, 0), argString(call, 1)))
	})

	set("markallread", func(call otto.FunctionCall) otto.Value {
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		return result(manager.MarkAllRead(ctx, principal, argString(call, 0), argString(call, 1)))
	})

	/*
		Messages
	*/

	set("list", func(call otto.FunctionCall) otto.Value {
		query := email.ListQuery{}
		if err := argJSON(call, 1, &query); err != nil {
			return fail(err)
		}
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		return result(manager.ListMessages(ctx, principal, argString(call, 0), query))
	})

	set("unified", func(call otto.FunctionCall) otto.Value {
		query := email.ListQuery{}
		if err := argJSON(call, 1, &query); err != nil {
			return fail(err)
		}
		accountIDs := []string{}
		if err := argJSON(call, 2, &accountIDs); err != nil {
			return fail(err)
		}
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		return result(manager.UnifiedList(ctx, principal, argString(call, 0), accountIDs, query))
	})

	set("get", func(call otto.FunctionCall) otto.Value {
		options := email.GetOptions{}
		if err := argJSON(call, 3, &options); err != nil {
			return fail(err)
		}
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		return result(manager.GetMessage(ctx, principal, argString(call, 0), argString(call, 1), argUint(call, 2), options))
	})

	set("rawsource", func(call otto.FunctionCall) otto.Value {
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		raw, err := manager.GetRaw(ctx, principal, argString(call, 0), argString(call, 1), argUint(call, 2))
		if err != nil {
			return fail(err)
		}
		const limit = 2 * 1024 * 1024
		source := raw.Data
		truncated := false
		if len(source) > limit {
			source = source[:limit]
			truncated = true
		}
		return ok(map[string]interface{}{
			"source":    strings.ToValidUTF8(string(source), "�"),
			"truncated": truncated,
			"size":      len(raw.Data),
		})
	})

	uidList := func(call otto.FunctionCall, index int) ([]uint32, error) {
		uids := []uint32{}
		if err := argJSON(call, index, &uids); err != nil {
			return nil, errors.New("invalid message list")
		}
		return uids, nil
	}

	set("setflag", func(call otto.FunctionCall) otto.Value {
		uids, err := uidList(call, 2)
		if err != nil {
			return fail(err)
		}
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		return result(manager.SetFlag(ctx, principal, argString(call, 0), argString(call, 1), uids, argString(call, 3), argBool(call, 4)))
	})

	set("move", func(call otto.FunctionCall) otto.Value {
		uids, err := uidList(call, 2)
		if err != nil {
			return fail(err)
		}
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		return result(manager.Move(ctx, principal, argString(call, 0), argString(call, 1), uids, argString(call, 3)))
	})

	set("copy", func(call otto.FunctionCall) otto.Value {
		uids, err := uidList(call, 2)
		if err != nil {
			return fail(err)
		}
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		return result(manager.Copy(ctx, principal, argString(call, 0), argString(call, 1), uids, argString(call, 3)))
	})

	set("movetorole", func(call otto.FunctionCall) otto.Value {
		uids, err := uidList(call, 2)
		if err != nil {
			return fail(err)
		}
		role := argString(call, 3)
		if role != email.RoleArchive && role != email.RoleJunk && role != email.RoleInbox && role != email.RoleTrash {
			return fail(errors.New("unknown destination " + role))
		}
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		return result(manager.MoveToRole(ctx, principal, argString(call, 0), argString(call, 1), uids, role))
	})

	set("remove", func(call otto.FunctionCall) otto.Value {
		uids, err := uidList(call, 2)
		if err != nil {
			return fail(err)
		}
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		return result(manager.Delete(ctx, principal, argString(call, 0), argString(call, 1), uids, argBool(call, 3)))
	})

	set("locate", func(call otto.FunctionCall) otto.Value {
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		return result(manager.LocateMessage(ctx, principal, argString(call, 0), argString(call, 1), argString(call, 2)))
	})

	set("checkinboxes", func(call otto.FunctionCall) otto.Value {
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		return result(manager.CheckInboxes(ctx, principal))
	})

	set("newsince", func(call otto.FunctionCall) otto.Value {
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		limit, _ := call.Argument(2).ToInteger()
		return result(manager.NewSince(ctx, principal, argString(call, 0), argUint(call, 1), int(limit)))
	})

	/*
		Files in the ArozOS file system
	*/

	set("savemessage", func(call otto.FunctionCall) otto.Value {
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		raw, err := manager.GetRaw(ctx, principal, argString(call, 0), argString(call, 1), argUint(call, 2))
		if err != nil {
			return fail(err)
		}
		saved, err := emailWriteUserFile(u, payload.ScriptFsh, vm, argString(call, 3), raw.Filename, raw.Data)
		return result(map[string]interface{}{"path": saved}, err)
	})

	set("saveattachment", func(call otto.FunctionCall) otto.Value {
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		part, err := manager.GetPart(ctx, principal, argString(call, 0), argString(call, 1), argUint(call, 2), argString(call, 3))
		if err != nil {
			return fail(err)
		}
		saved, err := emailWriteUserFile(u, payload.ScriptFsh, vm, argString(call, 4), part.Filename, part.Data)
		return result(map[string]interface{}{"path": saved, "filename": part.Filename, "contentType": part.ContentType}, err)
	})

	set("saveallattachments", func(call otto.FunctionCall) otto.Value {
		ids := []string{}
		if err := argJSON(call, 3, &ids); err != nil {
			return fail(err)
		}
		ctx, cancel := requestContext(emailSendTimeout)
		defer cancel()
		saved := []string{}
		for _, id := range ids {
			part, err := manager.GetPart(ctx, principal, argString(call, 0), argString(call, 1), argUint(call, 2), id)
			if err != nil {
				return emailFailureWith(vm, err, map[string]interface{}{"saved": saved})
			}
			path, err := emailWriteUserFile(u, payload.ScriptFsh, vm, argString(call, 4), part.Filename, part.Data)
			if err != nil {
				return emailFailureWith(vm, err, map[string]interface{}{"saved": saved})
			}
			saved = append(saved, path)
		}
		return ok(map[string]interface{}{"paths": saved})
	})

	set("openeml", func(call otto.FunctionCall) otto.Value {
		vpath := argString(call, 0)
		raw, err := emailReadUserFile(u, payload.ScriptFsh, vm, vpath, emailMaxEMLBytes)
		if err != nil {
			return fail(err)
		}
		message, err := manager.ParseEML(principal, raw, argBool(call, 1))
		if err != nil {
			return fail(err)
		}
		return ok(map[string]interface{}{"message": message, "path": vpath})
	})

	set("saveemlattachment", func(call otto.FunctionCall) otto.Value {
		raw, err := emailReadUserFile(u, payload.ScriptFsh, vm, argString(call, 0), emailMaxEMLBytes)
		if err != nil {
			return fail(err)
		}
		part, err := email.EMLPart(raw, argString(call, 1))
		if err != nil {
			return fail(err)
		}
		saved, err := emailWriteUserFile(u, payload.ScriptFsh, vm, argString(call, 2), part.Filename, part.Data)
		return result(map[string]interface{}{"path": saved, "filename": part.Filename, "contentType": part.ContentType}, err)
	})

	set("importeml", func(call otto.FunctionCall) otto.Value {
		raw, err := emailReadUserFile(u, payload.ScriptFsh, vm, argString(call, 0), emailMaxEMLBytes)
		if err != nil {
			return fail(err)
		}
		ctx, cancel := detachedContext(emailSendTimeout)
		defer cancel()
		uid, err := manager.ImportMessage(ctx, principal, argString(call, 1), argString(call, 2), raw)
		return result(map[string]interface{}{"uid": uid}, err)
	})

	set("tempfolder", func(call otto.FunctionCall) otto.Value {
		//A private scratch folder for uploads and downloads, pruned daily
		emailCleanTemp(u)
		purpose := strings.Trim(argString(call, 0), "/\\. ")
		if purpose != "uploads" && purpose != "downloads" {
			purpose = "downloads"
		}
		folder := emailTempRoot + "/" + purpose + "/" + time.Now().Format("20060102150405") + "-" + randomHex(4)
		fsh, rpath, err := static.VirtualPathToRealPath(folder, u)
		if err != nil {
			return fail(err)
		}
		if err := fsh.FileSystemAbstraction.MkdirAll(rpath, 0775); err != nil {
			return fail(err)
		}
		return ok(folder)
	})

	/*
		Composing
	*/

	composeRequest := func(call otto.FunctionCall) (*email.ComposeRequest, error) {
		input := emailComposeInput{}
		if err := argJSON(call, 0, &input); err != nil {
			return nil, errors.New("invalid message: " + err.Error())
		}
		request := input.ComposeRequest
		for _, file := range input.Files {
			attachment, err := emailAttachmentFromPath(u, payload.ScriptFsh, vm, file.Path, file.Name)
			if err != nil {
				return nil, err
			}
			request.Attachments = append(request.Attachments, *attachment)
		}
		return &request, nil
	}

	set("send", func(call otto.FunctionCall) otto.Value {
		request, err := composeRequest(call)
		if err != nil {
			return fail(err)
		}
		ctx, cancel := detachedContext(emailSendTimeout)
		defer cancel()
		return result(manager.Send(ctx, principal, request))
	})

	set("savedraft", func(call otto.FunctionCall) otto.Value {
		request, err := composeRequest(call)
		if err != nil {
			return fail(err)
		}
		ctx, cancel := detachedContext(emailSendTimeout)
		defer cancel()
		return result(manager.SaveDraft(ctx, principal, request))
	})

	set("deletedraft", func(call otto.FunctionCall) otto.Value {
		ctx, cancel := requestContext(emailReadTimeout)
		defer cancel()
		return result(true, manager.DeleteDraft(ctx, principal, argString(call, 0), argString(call, 1), argUint(call, 2)))
	})

	set("outbox", func(call otto.FunctionCall) otto.Value {
		return result(manager.Outbox(principal))
	})

	set("outboxcancel", func(call otto.FunctionCall) otto.Value {
		ctx, cancel := detachedContext(emailReadTimeout)
		defer cancel()
		return result(manager.OutboxCancel(ctx, principal, argString(call, 0), argBool(call, 1)))
	})

	set("outboxsendnow", func(call otto.FunctionCall) otto.Value {
		return result(true, manager.OutboxSendNow(principal, argString(call, 0)))
	})

	/*
		Address book
	*/

	set("contacts", func(call otto.FunctionCall) otto.Value {
		return result(manager.Contacts(principal))
	})

	set("searchcontacts", func(call otto.FunctionCall) otto.Value {
		limit, _ := call.Argument(1).ToInteger()
		return result(manager.SearchContacts(principal, argString(call, 0), int(limit)))
	})

	set("savecontact", func(call otto.FunctionCall) otto.Value {
		contact := email.Contact{}
		if err := argJSON(call, 0, &contact); err != nil {
			return fail(err)
		}
		return result(manager.SaveContact(principal, contact))
	})

	set("deletecontact", func(call otto.FunctionCall) otto.Value {
		return result(true, manager.DeleteContact(principal, argString(call, 0)))
	})

	set("importcontacts", func(call otto.FunctionCall) otto.Value {
		contacts := []email.Contact{}
		if err := argJSON(call, 0, &contacts); err != nil {
			return fail(err)
		}
		return result(manager.ImportContacts(principal, contacts))
	})

	/*
		Labels and snoozing
	*/

	set("labels", func(call otto.FunctionCall) otto.Value {
		return ok(manager.Labels(principal))
	})

	set("savelabels", func(call otto.FunctionCall) otto.Value {
		labels := []email.Label{}
		if err := argJSON(call, 0, &labels); err != nil {
			return fail(err)
		}
		return result(manager.SaveLabels(principal, labels))
	})

	set("setlabels", func(call otto.FunctionCall) otto.Value {
		summary := email.MessageSummary{}
		if err := argJSON(call, 0, &summary); err != nil {
			return fail(err)
		}
		labels := []string{}
		if err := argJSON(call, 1, &labels); err != nil {
			return fail(err)
		}
		return result(true, manager.SetMessageLabels(principal, summary, labels))
	})

	set("labelmessages", func(call otto.FunctionCall) otto.Value {
		return result(manager.LabelMessages(principal, argString(call, 0)))
	})

	set("snooze", func(call otto.FunctionCall) otto.Value {
		summary := email.MessageSummary{}
		if err := argJSON(call, 0, &summary); err != nil {
			return fail(err)
		}
		until, _ := call.Argument(1).ToInteger()
		return result(true, manager.Snooze(principal, summary, until))
	})

	set("unsnooze", func(call otto.FunctionCall) otto.Value {
		summary := email.MessageSummary{}
		if err := argJSON(call, 0, &summary); err != nil {
			return fail(err)
		}
		return result(true, manager.Unsnooze(principal, summary))
	})

	set("snoozed", func(call otto.FunctionCall) otto.Value {
		return result(manager.SnoozedMessages(principal))
	})

	/*
		Preferences and administration
	*/

	set("settings", func(call otto.FunctionCall) otto.Value {
		return ok(manager.Settings(principal))
	})

	set("savesettings", func(call otto.FunctionCall) otto.Value {
		settings := manager.Settings(principal)
		if err := argJSON(call, 0, &settings); err != nil {
			return fail(err)
		}
		return result(manager.SaveSettings(principal, settings))
	})

	set("trustsender", func(call otto.FunctionCall) otto.Value {
		return result(true, manager.TrustSender(principal, argString(call, 0)))
	})

	set("isadmin", func(call otto.FunctionCall) otto.Value {
		return ok(principal.Admin)
	})

	set("adminconfig", func(call otto.FunctionCall) otto.Value {
		if !principal.Admin {
			return fail(errors.New("permission denied"))
		}
		return ok(manager.AdminConfig())
	})

	set("setadminconfig", func(call otto.FunctionCall) otto.Value {
		input := email.AdminConfigInput{}
		if err := argJSON(call, 0, &input); err != nil {
			return fail(err)
		}
		return result(true, manager.SetAdminConfig(principal, input))
	})

	vm.Run(emailLibJavaScript)
}

// emailLibJavaScript wraps the native calls into the `email` object. Objects
// cross the boundary as JSON so scripts always get plain JavaScript values.
const emailLibJavaScript = `
	var email = {};
	(function(){
		var parse = function(raw) {
			if (raw === undefined || raw === null || raw === false) {
				return {success: false, error: "email call failed"};
			}
			try { return JSON.parse(raw); } catch (e) { return {success: false, error: "malformed email response"}; }
		};
		var json = function(value) {
			if (value === undefined || value === null) { return ""; }
			return JSON.stringify(value);
		};

		email.providers = function() { return parse(_email_providers()); };
		email.discover = function(address) { return parse(_email_discover(address)); };
		email.oauthProviders = function() { return parse(_email_oauthproviders()); };
		email.oauthStart = function(provider, address, redirectURI) { return parse(_email_oauthstart(provider, address || "", redirectURI || "")); };
		email.oauthComplete = function(state, codeOrURL) { return parse(_email_oauthcomplete(state || "", codeOrURL || "")); };
		email.oauthStatus = function(state) { return parse(_email_oauthstatus(state)); };
		email.oauthCancel = function(state) { return parse(_email_oauthcancel(state)); };

		email.listAccounts = function() { return parse(_email_listaccounts()); };
		email.getAccount = function(id) { return parse(_email_getaccount(id)); };
		email.testAccount = function(input) { return parse(_email_testaccount(json(input))); };
		email.addAccount = function(input) { return parse(_email_addaccount(json(input))); };
		email.updateAccount = function(id, input) { return parse(_email_updateaccount(id, json(input))); };
		email.removeAccount = function(id) { return parse(_email_removeaccount(id)); };
		email.reorderAccounts = function(ids) { return parse(_email_reorderaccounts(json(ids || []))); };

		email.folders = function(accountId, refresh) { return parse(_email_folders(accountId, refresh === true)); };
		email.createFolder = function(accountId, parent, name) { return parse(_email_createfolder(accountId, parent || "", name)); };
		email.renameFolder = function(accountId, folder, newName) { return parse(_email_renamefolder(accountId, folder, newName)); };
		email.deleteFolder = function(accountId, folder) { return parse(_email_deletefolder(accountId, folder)); };
		email.emptyFolder = function(accountId, folder) { return parse(_email_emptyfolder(accountId, folder)); };
		email.markAllRead = function(accountId, folder) { return parse(_email_markallread(accountId, folder)); };

		email.list = function(accountId, query) { return parse(_email_list(accountId, json(query || {}))); };
		email.unified = function(view, query, accountIds) { return parse(_email_unified(view || "inbox", json(query || {}), json(accountIds || []))); };
		email.get = function(accountId, folder, uid, options) { return parse(_email_get(accountId, folder, uid, json(options || {}))); };
		email.rawSource = function(accountId, folder, uid) { return parse(_email_rawsource(accountId, folder, uid)); };
		email.setFlag = function(accountId, folder, uids, flag, value) { return parse(_email_setflag(accountId, folder, json(uids), flag, value !== false)); };
		email.move = function(accountId, folder, uids, destination) { return parse(_email_move(accountId, folder, json(uids), destination)); };
		email.copy = function(accountId, folder, uids, destination) { return parse(_email_copy(accountId, folder, json(uids), destination)); };
		email.moveToRole = function(accountId, folder, uids, role) { return parse(_email_movetorole(accountId, folder, json(uids), role)); };
		email.remove = function(accountId, folder, uids, permanent) { return parse(_email_remove(accountId, folder, json(uids), permanent === true)); };
		email.locate = function(accountId, messageId, hint) { return parse(_email_locate(accountId, messageId, hint || "")); };
		email.checkInboxes = function() { return parse(_email_checkinboxes()); };
		email.newSince = function(accountId, uidNext, limit) { return parse(_email_newsince(accountId, uidNext, limit || 5)); };

		email.saveMessage = function(accountId, folder, uid, destDir) { return parse(_email_savemessage(accountId, folder, uid, destDir)); };
		email.saveAttachment = function(accountId, folder, uid, partId, destDir) { return parse(_email_saveattachment(accountId, folder, uid, partId, destDir)); };
		email.saveAllAttachments = function(accountId, folder, uid, partIds, destDir) { return parse(_email_saveallattachments(accountId, folder, uid, json(partIds || []), destDir)); };
		email.openEml = function(vpath, allowRemote) { return parse(_email_openeml(vpath, allowRemote === true)); };
		email.saveEmlAttachment = function(vpath, partId, destDir) { return parse(_email_saveemlattachment(vpath, partId, destDir)); };
		email.importEml = function(vpath, accountId, folder) { return parse(_email_importeml(vpath, accountId, folder || "INBOX")); };
		email.tempFolder = function(purpose) { return parse(_email_tempfolder(purpose || "downloads")); };

		email.send = function(message) { return parse(_email_send(json(message))); };
		email.saveDraft = function(message) { return parse(_email_savedraft(json(message))); };
		email.deleteDraft = function(accountId, folder, uid) { return parse(_email_deletedraft(accountId, folder, uid)); };
		email.outbox = function() { return parse(_email_outbox()); };
		email.outboxCancel = function(id, toDrafts) { return parse(_email_outboxcancel(id, toDrafts === true)); };
		email.outboxSendNow = function(id) { return parse(_email_outboxsendnow(id)); };

		email.contacts = function() { return parse(_email_contacts()); };
		email.searchContacts = function(query, limit) { return parse(_email_searchcontacts(query || "", limit || 8)); };
		email.saveContact = function(contact) { return parse(_email_savecontact(json(contact))); };
		email.deleteContact = function(address) { return parse(_email_deletecontact(address)); };
		email.importContacts = function(contacts) { return parse(_email_importcontacts(json(contacts || []))); };

		email.labels = function() { return parse(_email_labels()); };
		email.saveLabels = function(labels) { return parse(_email_savelabels(json(labels || []))); };
		email.setLabels = function(message, labelIds) { return parse(_email_setlabels(json(message), json(labelIds || []))); };
		email.labelMessages = function(labelId) { return parse(_email_labelmessages(labelId)); };
		email.snooze = function(message, until) { return parse(_email_snooze(json(message), until)); };
		email.unsnooze = function(message) { return parse(_email_unsnooze(json(message))); };
		email.snoozed = function() { return parse(_email_snoozed()); };

		email.settings = function() { return parse(_email_settings()); };
		email.saveSettings = function(settings) { return parse(_email_savesettings(json(settings))); };
		email.trustSender = function(sender) { return parse(_email_trustsender(sender)); };
		email.isAdmin = function() { return parse(_email_isadmin()); };
		email.adminConfig = function() { return parse(_email_adminconfig()); };
		email.setAdminConfig = function(config) { return parse(_email_setadminconfig(json(config))); };
	})();
`

// emailResponse builds the {success, data} / {success, error, …} envelope.
func emailResponse(vm *otto.Otto, data interface{}, err error) otto.Value {
	if err != nil {
		return emailFailureWith(vm, err, nil)
	}
	encoded, merr := json.Marshal(map[string]interface{}{"success": true, "data": data})
	if merr != nil {
		return emailFailureWith(vm, merr, nil)
	}
	value, _ := vm.ToValue(string(encoded))
	return value
}

// emailFailureWith reports an error, classifying it for the front-end.
func emailFailureWith(vm *otto.Otto, err error, extra map[string]interface{}) otto.Value {
	payload := map[string]interface{}{"success": false, "error": err.Error()}
	if email.IsAuthError(err) {
		payload["authFailed"] = true
		if hint := email.AuthHint(err); hint != "" {
			payload["hint"] = hint
		}
	}
	switch {
	case errors.Is(err, email.ErrAccountNotFound), errors.Is(err, email.ErrFolderNotFound), errors.Is(err, email.ErrMessageNotFound):
		payload["code"] = "notfound"
	case errors.Is(err, email.ErrBlockedAddress), errors.Is(err, email.ErrInsecureBlocked):
		payload["code"] = "blocked"
	case errors.Is(err, email.ErrTooLarge):
		payload["code"] = "toolarge"
	case errors.Is(err, email.ErrOAuthDisabled):
		payload["code"] = "oauthdisabled"
	}
	for key, value := range extra {
		if key == "hint" {
			if text, ok := value.(string); !ok || text == "" {
				continue
			}
		}
		if key == "authFailed" {
			if flag, ok := value.(bool); !ok || !flag {
				continue
			}
		}
		payload[key] = value
	}
	encoded, _ := json.Marshal(payload)
	value, _ := vm.ToValue(string(encoded))
	return value
}

// emailResolveFile resolves a readable file path for the calling user.
func emailResolveFile(u *user.User, scriptFsh *filesystem.FileSystemHandler, vm *otto.Otto, vpath string) (*filesystem.FileSystemHandler, string, string, error) {
	vpath = strings.TrimSpace(vpath)
	if vpath == "" {
		return nil, "", "", errors.New("no file selected")
	}
	vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)
	if !u.CanRead(vpath) {
		return nil, "", "", errors.New("access denied: " + vpath)
	}
	fsh, rpath, err := static.VirtualPathToRealPath(vpath, u)
	if err != nil {
		return nil, "", "", err
	}
	if !fsh.FileSystemAbstraction.FileExists(rpath) || fsh.FileSystemAbstraction.IsDir(rpath) {
		return nil, "", "", errors.New("file not found: " + vpath)
	}
	return fsh, rpath, vpath, nil
}

// emailReadUserFile reads a whole file (an .eml) with a size cap.
func emailReadUserFile(u *user.User, scriptFsh *filesystem.FileSystemHandler, vm *otto.Otto, vpath string, maxBytes int64) ([]byte, error) {
	fsh, rpath, _, err := emailResolveFile(u, scriptFsh, vm, vpath)
	if err != nil {
		return nil, err
	}
	if size := fsh.FileSystemAbstraction.GetFileSize(rpath); size > maxBytes {
		return nil, email.ErrTooLarge
	}
	return fsh.FileSystemAbstraction.ReadFile(rpath)
}

// emailAttachmentFromPath turns a file the user picked into an attachment
// that is streamed when the message is rendered.
func emailAttachmentFromPath(u *user.User, scriptFsh *filesystem.FileSystemHandler, vm *otto.Otto, vpath string, name string) (*email.ComposeAttachment, error) {
	fsh, rpath, resolved, err := emailResolveFile(u, scriptFsh, vm, vpath)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(name) == "" {
		name = filepath.Base(arozfs.ToSlash(resolved))
	}
	abstraction := fsh.FileSystemAbstraction
	return &email.ComposeAttachment{
		Name: name,
		Size: abstraction.GetFileSize(rpath),
		Open: func() (io.ReadCloser, error) { return abstraction.ReadStream(rpath) },
	}, nil
}

// emailWriteUserFile saves data into a folder of the user's file system under
// a name that does not overwrite anything, and charges it to their quota.
func emailWriteUserFile(u *user.User, scriptFsh *filesystem.FileSystemHandler, vm *otto.Otto, vdir string, filename string, data []byte) (string, error) {
	vdir = strings.TrimSpace(vdir)
	if vdir == "" {
		return "", errors.New("choose a folder to save into")
	}
	vdir = static.RelativeVpathRewrite(scriptFsh, vdir, vm, u)
	vdir = strings.TrimSuffix(vdir, "/")
	if strings.HasSuffix(vdir, ":") {
		vdir += "/"
	}
	if !u.CanWrite(vdir) {
		return "", errors.New("access denied: " + vdir)
	}
	if !u.StorageQuota.HaveSpace(int64(len(data))) {
		return "", errors.New("storage quota exceeded")
	}

	fsh, rdir, err := static.VirtualPathToRealPath(vdir, u)
	if err != nil {
		return "", err
	}
	if fsh.ReadOnly {
		return "", errors.New(fsh.Name + " is read only")
	}
	abstraction := fsh.FileSystemAbstraction
	if !abstraction.FileExists(rdir) {
		if err := abstraction.MkdirAll(rdir, 0775); err != nil {
			return "", err
		}
	}

	filename = emailSafeName(filename)
	base, ext := filename, filepath.Ext(filename)
	if ext != "" {
		base = strings.TrimSuffix(filename, ext)
	}
	name := filename
	for index := 1; abstraction.FileExists(arozfs.ToSlash(filepath.Join(rdir, name))); index++ {
		if index > 999 {
			return "", errors.New("too many files with the same name")
		}
		name = fmt.Sprintf("%s (%d)%s", base, index, ext)
	}

	target := arozfs.ToSlash(filepath.Join(rdir, name))
	if err := abstraction.WriteFile(target, data, 0775); err != nil {
		return "", err
	}
	vpath := strings.TrimSuffix(vdir, "/") + "/" + name
	u.SetOwnerOfFile(fsh, vpath)
	return vpath, nil
}

// emailSafeName keeps a server supplied file name inside its folder.
func emailSafeName(name string) string {
	name = strings.TrimSpace(strings.NewReplacer("/", "_", "\\", "_", "\x00", "").Replace(name))
	name = strings.Trim(name, ". ")
	if name == "" {
		return "attachment"
	}
	return name
}

// emailCleanTemp prunes old scratch files under tmp:/Mail, at most hourly.
func emailCleanTemp(u *user.User) {
	emailTempCleanMutex.Lock()
	last, seen := emailTempCleaned[u.Username]
	if seen && time.Since(last) < time.Hour {
		emailTempCleanMutex.Unlock()
		return
	}
	emailTempCleaned[u.Username] = time.Now()
	emailTempCleanMutex.Unlock()

	fsh, rpath, err := static.VirtualPathToRealPath(emailTempRoot, u)
	if err != nil || !fsh.FileSystemAbstraction.FileExists(rpath) {
		return
	}
	for _, purpose := range []string{"uploads", "downloads"} {
		dir := arozfs.ToSlash(filepath.Join(rpath, purpose))
		entries, err := fsh.FileSystemAbstraction.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			info, err := entry.Info()
			if err != nil || time.Since(info.ModTime()) < emailTempMaxAge {
				continue
			}
			fsh.FileSystemAbstraction.RemoveAll(arozfs.ToSlash(filepath.Join(dir, entry.Name())))
		}
	}
}

func randomHex(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}
