package agi

import (
	"bytes"
	"compress/gzip"
	"crypto/sha1"
	"encoding/base64"
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
	"imuslab.com/arozos/mod/user"
)

/*
	AGI Office Document Library

	Converters between the ArozOS Office suite webapps (Docs / Sheets /
	Slides, src/web/Office/) and common office file formats. The heavy
	lifting lives in mod/office; this file only wires it into the AGI VM
	with per-user permission and virtual-path handling.

	The suite's own documents ARE .docx / .xlsx / .pptx (mod/office
	native.go): the OOXML plus the editor's envelope embedded in the package.

	    office.saveDocument(envelopeJson, destVpath)  => write the envelope as the Office
	                                                     file its extension names; media?file=
	                                                     links are read server side
	    office.loadDocument(srcVpath, workdirBase)    => envelope JSON string: the embedded
	                                                     copy when current, else an import;
	                                                     media extracted to a per-document
	                                                     working dir and linked
	    office.readPayload(vpath)                     => the text of an uploaded payload file,
	                                                     gunzipped when it is gzip

	Format conversions:
	    office.pptxToPresentation(srcVpath)           => JSON body string (Slides schema)
	    office.presentationToPptx(jsonStr, destVpath) => true on success; when the deck
	                                                     has video/audio, their files are
	                                                     written to <dest>.zip and that
	                                                     vpath (string) is returned instead
	    office.xlsxToWorkbook(srcVpath)               => JSON body string (Sheets schema)
	    office.workbookToXlsx(jsonStr, destVpath)     => true on success
	    office.docxToDocument(srcVpath)               => JSON body string (Docs schema)
	    office.documentToDocx(jsonStr, destVpath)     => true on success
	    office.packToFile(envelopeJson, destVpath)    => write a session snapshot container
	    office.unpackToWorkdir(srcVpath, workdirBase) => envelope JSON of a snapshot (assets
	                                                     extracted to a per-document working dir,
	                                                     referenced by media?file= links)
	    office.odtToDocument(srcVpath)                => JSON body string (Docs schema)
	    office.documentToOdt(jsonStr, destVpath)      => true on success
	    office.odsToWorkbook(srcVpath)                => JSON body string (Sheets schema)
	    office.workbookToOds(jsonStr, destVpath)      => true on success
	    office.odpToPresentation(srcVpath)            => JSON body string (Slides schema)
	    office.presentationToOdp(jsonStr, destVpath)  => true on success
	    office.documentToPdf(jsonStr, destVpath)      => true on success (real-text PDF)
	    office.workbookPrintToPdf(printJson, destVpath) => true on success (client print model)

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

// officeVpathReader resolves the media?file= links a document carries,
// through the same read permission the user has everywhere else
func officeVpathReader(u *user.User) func(string) ([]byte, error) {
	return func(vp string) ([]byte, error) {
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
}

// officeMaxPayload caps an uploaded (and possibly gzipped) request payload
const officeMaxPayload = 512 << 20

func (g *Gateway) injectOfficeLibFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	u := payload.User
	scriptFsh := payload.ScriptFsh
	readVpath := officeVpathReader(u)

	// writeOut writes bytes to a checked, already rewritten vpath
	writeOut := func(destVpath string, data []byte) error {
		destFsh, destRpath, err := static.VirtualPathToRealPath(destVpath, u)
		if err != nil {
			return err
		}
		if err := destFsh.FileSystemAbstraction.WriteStream(destRpath, bytes.NewReader(data), 0755); err != nil {
			return err
		}
		u.SetOwnerOfFile(destFsh, destVpath)
		return nil
	}
	// readIn reads a checked, already rewritten vpath
	readIn := func(srcVpath string) ([]byte, error) {
		srcFsh, srcRpath, err := static.VirtualPathToRealPath(srcVpath, u)
		if err != nil {
			return nil, err
		}
		f, err := srcFsh.FileSystemAbstraction.ReadStream(srcRpath)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		return io.ReadAll(f)
	}

	// saveDocument(envelopeJson, destVpath) => true: the suite's own save.
	// The extension decides the format (.docx / .xlsx / .pptx) and must
	// match the envelope's app.
	vm.Set("_office_saveDocument", func(call otto.FunctionCall) otto.Value {
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
		app := office.AppForExt(filepath.Ext(destVpath))
		if app == "" {
			panic(vm.MakeCustomError("UnsupportedFormat", "Office documents are saved as .docx, .xlsx or .pptx: "+destVpath))
		}
		data, err := office.BuildNativeFile(app, envelope, readVpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		if err := writeOut(destVpath, data); err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	// loadDocument(srcVpath, workdirBase) => envelope JSON string. Media is
	// written into <workdirBase>/<doc-hash>/ and linked by media?file=, so
	// the browser streams pictures instead of receiving them as base64.
	vm.Set("_office_loadDocument", func(call otto.FunctionCall) otto.Value {
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
		app := office.AppForExt(filepath.Ext(srcVpath))
		if app == "" {
			panic(vm.MakeCustomError("UnsupportedFormat", "not a .docx, .xlsx or .pptx file: "+srcVpath))
		}
		data, err := readIn(srcVpath)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		h := sha1.Sum([]byte(srcVpath))
		docDirV := workdirBase + "/" + hex.EncodeToString(h[:])[:12]
		wdFsh, docDirR, err := static.VirtualPathToRealPath(docDirV, u)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		sink := func(name string, content []byte) (string, error) {
			name = filepath.Base(name)
			if err := wdFsh.FileSystemAbstraction.MkdirAll(docDirR, 0755); err != nil {
				return "", err
			}
			if err := wdFsh.FileSystemAbstraction.WriteStream(filepath.Join(docDirR, name), bytes.NewReader(content), 0755); err != nil {
				return "", err
			}
			return "../../media?file=" + url.QueryEscape(docDirV+"/"+name), nil
		}
		envelope, err := office.ReadNativeFile(app, data, sink)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		reply, _ := vm.ToValue(envelope)
		return reply
	})

	// readPayload(vpath) => string: a request payload the front end uploaded
	// as a file instead of posting it (OfficeApp.agirunLarge), gzipped when
	// the browser could compress it. The caller deletes the file.
	vm.Set("_office_readPayload", func(call otto.FunctionCall) otto.Value {
		vp, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		vp = static.RelativeVpathRewrite(scriptFsh, vp, vm, u)
		if !u.CanRead(vp) {
			panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+vp))
		}
		data, err := readIn(vp)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		if len(data) >= 2 && data[0] == 0x1f && data[1] == 0x8b {
			zr, err := gzip.NewReader(bytes.NewReader(data))
			if err != nil {
				g.RaiseError(err)
				return otto.NullValue()
			}
			plain, err := io.ReadAll(io.LimitReader(zr, officeMaxPayload+1))
			zr.Close()
			if err != nil {
				g.RaiseError(err)
				return otto.NullValue()
			}
			if len(plain) > officeMaxPayload {
				g.RaiseError(errors.New("payload is too large"))
				return otto.NullValue()
			}
			data = plain
		}
		reply, _ := vm.ToValue(string(data))
		return reply
	})

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
		// media?file= links (pictures, video, audio) are read here, so their
		// bytes never ride the JSON payload
		data, mediaZip, err := office.BuildPptxMedia(pres, readVpath)
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

		// video/audio files ship in a sidecar zip next to the pptx
		// (media is not embedded - playback support is unreliable);
		// returns the zip vpath (string) instead of true when written
		if len(mediaZip) > 0 {
			zipVpath := strings.TrimSuffix(destVpath, filepath.Ext(destVpath)) + ".zip"
			if !u.CanWrite(zipVpath) {
				panic(vm.MakeCustomError("PermissionDenied", "Write access denied: "+zipVpath))
			}
			zipFsh, zipRpath, err := static.VirtualPathToRealPath(zipVpath, u)
			if err != nil {
				g.RaiseError(err)
				return otto.FalseValue()
			}
			err = zipFsh.FileSystemAbstraction.WriteStream(zipRpath, bytes.NewReader(mediaZip), 0755)
			if err != nil {
				g.RaiseError(err)
				return otto.FalseValue()
			}
			u.SetOwnerOfFile(zipFsh, zipVpath)
			reply, _ := vm.ToValue(zipVpath)
			return reply
		}

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
		data, err := office.BuildDocxMedia(doc, readVpath)
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

		// media?file= links inside the document become embedded assets
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

	/* ---------- OpenDocument (odt / ods / odp) ----------
	   Same permission / vpath handling as the OOXML converters, factored
	   through two generic closures since all six calls share their shape. */

	// importFn(srcVpath) => JSON body string
	registerOdfImport := func(fnName string, convert func([]byte) (string, error)) {
		vm.Set(fnName, func(call otto.FunctionCall) otto.Value {
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
			jsonBody, err := convert(data)
			if err != nil {
				g.RaiseError(err)
				return otto.NullValue()
			}
			reply, _ := vm.ToValue(jsonBody)
			return reply
		})
	}
	// exportFn(jsonStr, destVpath) => true on success
	registerOdfExport := func(fnName string, convert func(string) ([]byte, error)) {
		vm.Set(fnName, func(call otto.FunctionCall) otto.Value {
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
			data, err := convert(jsonStr)
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
	}
	registerOdfImport("_office_odtToDocument", func(data []byte) (string, error) {
		doc, err := office.ParseOdt(data)
		if err != nil {
			return "", err
		}
		return office.DocumentToJSON(doc)
	})
	registerOdfExport("_office_documentToOdt", func(jsonStr string) ([]byte, error) {
		// the ODF writers take inline pictures only: read the links here
		jsonStr, err := office.InlineMediaLinks(jsonStr, readVpath)
		if err != nil {
			return nil, err
		}
		doc, err := office.ParseDocumentJSON(jsonStr)
		if err != nil {
			return nil, err
		}
		return office.BuildOdt(doc)
	})
	registerOdfImport("_office_odsToWorkbook", func(data []byte) (string, error) {
		wb, err := office.ParseOds(data)
		if err != nil {
			return "", err
		}
		return office.WorkbookToJSON(wb)
	})
	registerOdfExport("_office_workbookToOds", func(jsonStr string) ([]byte, error) {
		wb, err := office.ParseWorkbookJSON(jsonStr)
		if err != nil {
			return nil, err
		}
		return office.BuildOds(wb)
	})
	registerOdfImport("_office_odpToPresentation", func(data []byte) (string, error) {
		pres, err := office.ParseOdp(data)
		if err != nil {
			return "", err
		}
		return office.PresentationToJSON(pres)
	})
	registerOdfExport("_office_presentationToOdp", func(jsonStr string) ([]byte, error) {
		jsonStr, err := office.InlineMediaLinks(jsonStr, readVpath)
		if err != nil {
			return nil, err
		}
		pres, err := office.ParsePresentationJSON(jsonStr)
		if err != nil {
			return nil, err
		}
		return office.BuildOdp(pres)
	})

	/* ---------- PDF export (real text, mod/office/pdf_*.go) ----------
	   Same (jsonStr, destVpath) shape as the ODF exporters. The Sheets
	   variant takes the client-computed print model (formatted display
	   strings + styles) instead of the raw workbook, since formula
	   evaluation lives in the web client. */
	registerOdfExport("_office_documentToPdf", func(jsonStr string) ([]byte, error) {
		jsonStr, err := office.InlineMediaLinks(jsonStr, readVpath)
		if err != nil {
			return nil, err
		}
		doc, err := office.ParseDocumentJSON(jsonStr)
		if err != nil {
			return nil, err
		}
		return office.BuildDocPdf(doc)
	})
	registerOdfExport("_office_workbookPrintToPdf", func(jsonStr string) ([]byte, error) {
		m, err := office.ParseSheetPrintJSON(jsonStr)
		if err != nil {
			return nil, err
		}
		return office.BuildSheetPdf(m)
	})

	/* ---------- write a file the web client produced ----------
	   Slides builds its PDF in the browser (only the browser knows how the
	   text actually laid out), so it needs a way to put those bytes on the
	   file system. Same (payload, destVpath) shape and the same write
	   permission check as every exporter above. */
	registerOdfExport("_office_writeBinaryFile", func(b64 string) ([]byte, error) {
		data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(b64))
		if err != nil {
			return nil, errors.New("payload is not valid base64: " + err.Error())
		}
		return data, nil
	})

	vm.Run(`
		var office = {};

		office.pptxToPresentation = _office_pptxToPresentation;   // pptx file -> Slides body JSON string
		office.presentationToPptx = _office_presentationToPptx;   // Slides body JSON string -> pptx file (+ media sidecar zip; returns its vpath)
		office.xlsxToWorkbook = _office_xlsxToWorkbook;           // xlsx file -> Sheets body JSON string
		office.workbookToXlsx = _office_workbookToXlsx;           // Sheets body JSON string -> xlsx file
		office.docxToDocument = _office_docxToDocument;           // docx file -> Docs body JSON string
		office.documentToDocx = _office_documentToDocx;           // Docs body JSON string -> docx file
		office.saveDocument = _office_saveDocument;               // envelope JSON -> .docx / .xlsx / .pptx (the suite's own save)
		office.loadDocument = _office_loadDocument;               // .docx / .xlsx / .pptx -> envelope JSON, media extracted to a workdir
		office.readPayload = _office_readPayload;                 // uploaded payload file -> string (gunzipped)
		office.packToFile = _office_packToFile;                   // envelope JSON -> session snapshot container file
		office.unpackToWorkdir = _office_unpackToWorkdir;         // session snapshot -> envelope JSON, assets extracted to a workdir

		office.odtToDocument = _office_odtToDocument;             // odt file -> Docs body JSON string
		office.documentToOdt = _office_documentToOdt;             // Docs body JSON string -> odt file
		office.odsToWorkbook = _office_odsToWorkbook;             // ods file -> Sheets body JSON string
		office.workbookToOds = _office_workbookToOds;             // Sheets body JSON string -> ods file
		office.odpToPresentation = _office_odpToPresentation;     // odp file -> Slides body JSON string
		office.presentationToOdp = _office_presentationToOdp;     // Slides body JSON string -> odp file

		office.documentToPdf = _office_documentToPdf;             // Docs body JSON string -> pdf file (real text)
		office.workbookPrintToPdf = _office_workbookPrintToPdf;   // Sheets print-model JSON -> pdf file (real text)
		office.writeBinaryFile = _office_writeBinaryFile;         // base64 string -> binary file (client-produced exports)
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

	// The suite's own save / open (envelope in, envelope out)
	if (requirelib("office")) {
		office.saveDocument(envelopeJson, "user:/Documents/report.docx");
		var env = office.loadDocument("user:/Documents/report.docx", "user:/.appdata/Office/cache");
	}
*/
