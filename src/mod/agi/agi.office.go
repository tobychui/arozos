package agi

import (
	"bytes"
	"fmt"
	"io"
	"os"

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

	Word (.docx) helpers for the Docs webapp will be added to the same
	library. Legacy binary formats (.ppt / .xls) are not supported.

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

	vm.Run(`
		var office = {};

		office.pptxToPresentation = _office_pptxToPresentation;   // pptx file -> Slides body JSON string
		office.presentationToPptx = _office_presentationToPptx;   // Slides body JSON string -> pptx file
		office.xlsxToWorkbook = _office_xlsxToWorkbook;           // xlsx file -> Sheets body JSON string
		office.workbookToXlsx = _office_workbookToXlsx;           // Sheets body JSON string -> xlsx file
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
