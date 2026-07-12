package agi

import (
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/office"
)

/*
	AGI Office Document Library

	Converters between the ArozOS Office suite webapps (Docs / Sheets /
	Slides, src/web/Office/) and common office file formats. The heavy
	lifting lives in mod/office; this file only wires it into the AGI VM
	with per-user permission and virtual-path handling.

	Currently exposed:
	    office.pptxToPresentation(srcVpath)           => JSON body string (Slides schema)
	    office.presentationToPptx(jsonStr, destVpath) => true on success
	    office.xlsxToWorkbook(srcVpath)               => JSON body string (Sheets schema)
	    office.workbookToXlsx(jsonStr, destVpath)     => true on success
	    office.docxToDocument(srcVpath)               => JSON body string (Docs schema)
	    office.documentToDocx(jsonStr, destVpath)     => true on success
	    office.packToFile(envelopeJson, destVpath)    => write native zip container
	    office.unpackFromFile(srcVpath)               => envelope JSON (assets as data URLs)
	    office.unpackToWorkdir(srcVpath, workdirBase) => envelope JSON (assets extracted to a
	                                                     per-document working dir, referenced by
	                                                     media?file= links - keeps the JSON small)

	Legacy binary formats (.ppt / .xls / .doc) are not supported.

	Author: tobychui
*/

func (g *Gateway) OfficeLibRegister() {
	err := g.RegisterLib("office", g.injectOfficeLibFunctions)
	if err != nil {
		logger.PrintAndLog("Agi", fmt.Sprint(err), nil)
		os.Exit(1)
	}
}

func (g *Gateway) injectOfficeLibFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	u := payload.User
	scriptFsh := payload.ScriptFsh

	// pptxToPresentation(srcVpath) => JSON string of the Slides body schema
	vm.Set("_office_pptxToPresentation", func(call otto.FunctionCall) otto.Value {
		srcVpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		srcVpath = static.RelativeVpathRewrite(scriptFsh, srcVpath, vm, u)
		if !u.CanRead(srcVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+srcVpath))
		}

		srcFsh, srcRpath, err := static.VirtualPathToRealPath(srcVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		// read the whole pptx into memory (zip needs random access)
		f, err := srcFsh.FileSystemAbstraction.ReadStream(srcRpath)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		data, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		pres, err := office.ParsePptx(data)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		jsonBody, err := office.PresentationToJSON(pres)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		reply, _ := vm.ToValue(jsonBody)
		return reply
	})

	// presentationToPptx(jsonStr, destVpath) => build a pptx and write it
	vm.Set("_office_presentationToPptx", func(call otto.FunctionCall) otto.Value {
		jsonStr, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		destVpath, err := call.Argument(1).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		destVpath = static.RelativeVpathRewrite(scriptFsh, destVpath, vm, u)
		if !u.CanWrite(destVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Write access denied: "+destVpath))
		}

		pres, err := office.ParsePresentationJSON(jsonStr)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		data, err := office.BuildPptx(pres)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		destFsh, destRpath, err := static.VirtualPathToRealPath(destVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		err = destFsh.FileSystemAbstraction.WriteStream(destRpath, bytes.NewReader(data), 0755)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		u.SetOwnerOfFile(destFsh, destVpath)

		reply, _ := vm.ToValue(true)
		return reply
	})

	// xlsxToWorkbook(srcVpath) => JSON string of the Sheets body schema
	vm.Set("_office_xlsxToWorkbook", func(call otto.FunctionCall) otto.Value {
		srcVpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		srcVpath = static.RelativeVpathRewrite(scriptFsh, srcVpath, vm, u)
		if !u.CanRead(srcVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+srcVpath))
		}

		srcFsh, srcRpath, err := static.VirtualPathToRealPath(srcVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		f, err := srcFsh.FileSystemAbstraction.ReadStream(srcRpath)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		data, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		wb, err := office.ParseXlsx(data)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		jsonBody, err := office.WorkbookToJSON(wb)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		reply, _ := vm.ToValue(jsonBody)
		return reply
	})

	// workbookToXlsx(jsonStr, destVpath) => build an xlsx and write it
	vm.Set("_office_workbookToXlsx", func(call otto.FunctionCall) otto.Value {
		jsonStr, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		destVpath, err := call.Argument(1).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		destVpath = static.RelativeVpathRewrite(scriptFsh, destVpath, vm, u)
		if !u.CanWrite(destVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Write access denied: "+destVpath))
		}

		wb, err := office.ParseWorkbookJSON(jsonStr)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		data, err := office.BuildXlsx(wb)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		destFsh, destRpath, err := static.VirtualPathToRealPath(destVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		err = destFsh.FileSystemAbstraction.WriteStream(destRpath, bytes.NewReader(data), 0755)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		u.SetOwnerOfFile(destFsh, destVpath)

		reply, _ := vm.ToValue(true)
		return reply
	})

	// docxToDocument(srcVpath) => JSON string of the Docs body schema
	vm.Set("_office_docxToDocument", func(call otto.FunctionCall) otto.Value {
		srcVpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		srcVpath = static.RelativeVpathRewrite(scriptFsh, srcVpath, vm, u)
		if !u.CanRead(srcVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+srcVpath))
		}

		srcFsh, srcRpath, err := static.VirtualPathToRealPath(srcVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		f, err := srcFsh.FileSystemAbstraction.ReadStream(srcRpath)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		data, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		doc, err := office.ParseDocx(data)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		jsonBody, err := office.DocumentToJSON(doc)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		reply, _ := vm.ToValue(jsonBody)
		return reply
	})

	// documentToDocx(jsonStr, destVpath) => build a docx and write it
	vm.Set("_office_documentToDocx", func(call otto.FunctionCall) otto.Value {
		jsonStr, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		destVpath, err := call.Argument(1).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		destVpath = static.RelativeVpathRewrite(scriptFsh, destVpath, vm, u)
		if !u.CanWrite(destVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Write access denied: "+destVpath))
		}

		doc, err := office.ParseDocumentJSON(jsonStr)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		data, err := office.BuildDocx(doc)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		destFsh, destRpath, err := static.VirtualPathToRealPath(destVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		err = destFsh.FileSystemAbstraction.WriteStream(destRpath, bytes.NewReader(data), 0755)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		u.SetOwnerOfFile(destFsh, destVpath)

		reply, _ := vm.ToValue(true)
		return reply
	})

	// packToFile(envelopeJson, destVpath) => write the native zip container
	// (media data URLs and legacy media?file= links become embedded assets)
	vm.Set("_office_packToFile", func(call otto.FunctionCall) otto.Value {
		envelope, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		destVpath, err := call.Argument(1).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		destVpath = static.RelativeVpathRewrite(scriptFsh, destVpath, vm, u)
		if !u.CanWrite(destVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Write access denied: "+destVpath))
		}

		// resolver for legacy media?file= links inside the document
		readVpath := func(vp string) ([]byte, error) {
			if !u.CanRead(vp) {
				return nil, errors.New("read access denied")
			}
			fsh, rp, err := static.VirtualPathToRealPath(vp, u)
			if err != nil {
				return nil, err
			}
			f, err := fsh.FileSystemAbstraction.ReadStream(rp)
			if err != nil {
				return nil, err
			}
			defer f.Close()
			return io.ReadAll(f)
		}

		data, err := office.PackEnvelope(envelope, readVpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		destFsh, destRpath, err := static.VirtualPathToRealPath(destVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		err = destFsh.FileSystemAbstraction.WriteStream(destRpath, bytes.NewReader(data), 0755)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		u.SetOwnerOfFile(destFsh, destVpath)

		reply, _ := vm.ToValue(true)
		return reply
	})

	// unpackFromFile(srcVpath) => envelope JSON string (assets re-inlined
	// as data URLs; legacy plain-JSON documents pass through unchanged)
	vm.Set("_office_unpackFromFile", func(call otto.FunctionCall) otto.Value {
		srcVpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		srcVpath = static.RelativeVpathRewrite(scriptFsh, srcVpath, vm, u)
		if !u.CanRead(srcVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+srcVpath))
		}

		srcFsh, srcRpath, err := static.VirtualPathToRealPath(srcVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		f, err := srcFsh.FileSystemAbstraction.ReadStream(srcRpath)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		data, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		envelope, err := office.UnpackEnvelope(data)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		reply, _ := vm.ToValue(envelope)
		return reply
	})

	// unpackToWorkdir(srcVpath, workdirBase) => envelope JSON string with
	// assets extracted into <workdirBase>/<doc-hash>/ and referenced by
	// media?file= links, so large media never rides inside the JSON
	vm.Set("_office_unpackToWorkdir", func(call otto.FunctionCall) otto.Value {
		srcVpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		workdirBase, err := call.Argument(1).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		srcVpath = static.RelativeVpathRewrite(scriptFsh, srcVpath, vm, u)
		workdirBase = strings.TrimSuffix(static.RelativeVpathRewrite(scriptFsh, workdirBase, vm, u), "/")
		if !u.CanRead(srcVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+srcVpath))
		}
		if !u.CanWrite(workdirBase) {
			panic(vm.MakeCustomError("PermissionDenied", "Write access denied: "+workdirBase))
		}

		srcFsh, srcRpath, err := static.VirtualPathToRealPath(srcVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		f, err := srcFsh.FileSystemAbstraction.ReadStream(srcRpath)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		data, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		// per-document cache dir keyed by the source path
		h := sha1.Sum([]byte(srcVpath))
		docDirV := workdirBase + "/" + hex.EncodeToString(h[:])[:12]
		wdFsh, docDirR, err := static.VirtualPathToRealPath(docDirV, u)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		envelope, err := office.UnpackEnvelopeToLinks(data,
			func(name string, content []byte) error {
				if err := wdFsh.FileSystemAbstraction.MkdirAll(docDirR, 0755); err != nil {
					return err
				}
				return wdFsh.FileSystemAbstraction.WriteStream(
					filepath.Join(docDirR, filepath.Base(name)), bytes.NewReader(content), 0755)
			},
			func(name string) string {
				return "../../media?file=" + url.QueryEscape(docDirV+"/"+name)
			})
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		reply, _ := vm.ToValue(envelope)
		return reply
	})

	vm.Run(`
		var office = {};

		office.pptxToPresentation = _office_pptxToPresentation;   // pptx file -> Slides body JSON string
		office.presentationToPptx = _office_presentationToPptx;   // Slides body JSON string -> pptx file
		office.xlsxToWorkbook = _office_xlsxToWorkbook;           // xlsx file -> Sheets body JSON string
		office.workbookToXlsx = _office_workbookToXlsx;           // Sheets body JSON string -> xlsx file
		office.docxToDocument = _office_docxToDocument;           // docx file -> Docs body JSON string
		office.documentToDocx = _office_documentToDocx;           // Docs body JSON string -> docx file
		office.packToFile = _office_packToFile;                   // envelope JSON -> native zip container file
		office.unpackFromFile = _office_unpackFromFile;           // container (or legacy JSON) file -> envelope JSON (data URLs)
		office.unpackToWorkdir = _office_unpackToWorkdir;         // container -> envelope JSON, assets extracted to a workdir
	`)
}

/*
	Example Usages

	// Import: convert a .pptx into the Slides editor body schema
	if (requirelib("office")) {
		var bodyJson = office.pptxToPresentation("user:/Desktop/deck.pptx");
		sendJSONResp('{"body":' + bodyJson + '}');
	}

	// Export: build a .pptx from a serialized Slides body
	if (requirelib("office")) {
		var ok = office.presentationToPptx(bodyJsonString, "user:/Desktop/out.pptx");
		if (ok) { sendResp("OK"); }
	}
*/
