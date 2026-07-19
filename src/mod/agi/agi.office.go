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
	    office.presentationToPptx(jsonStr, destVpath) => true on success; when the deck
	                                                     has video/audio, their files are
	                                                     written to <dest>.zip and that
	                                                     vpath (string) is returned instead
	    office.xlsxToWorkbook(srcVpath)               => JSON body string (Sheets schema)
	    office.workbookToXlsx(jsonStr, destVpath)     => true on success
	    office.docxToDocument(srcVpath)               => JSON body string (Docs schema)
	    office.documentToDocx(jsonStr, destVpath)     => true on success
	    office.packToFile(envelopeJson, destVpath)    => write native zip container
	    office.unpackFromFile(srcVpath)               => envelope JSON (assets as data URLs)
	    office.unpackToWorkdir(srcVpath, workdirBase) => envelope JSON (assets extracted to a
	                                                     per-document working dir, referenced by
	                                                     media?file= links - keeps the JSON small)
	    office.odtToDocument(srcVpath)                => JSON body string (Docs schema)
	    office.documentToOdt(jsonStr, destVpath)      => true on success
	    office.odsToWorkbook(srcVpath)                => JSON body string (Sheets schema)
	    office.workbookToOds(jsonStr, destVpath)      => true on success
	    office.odpToPresentation(srcVpath)            => JSON body string (Slides schema)
	    office.presentationToOdp(jsonStr, destVpath)  => true on success
	    office.documentToPdf(jsonStr, destVpath)      => true on success (real-text PDF)
	    office.workbookPrintToPdf(printJson, destVpath) => true on success (client print model)
	    office.presentationToPdf(jsonStr, destVpath)  => true on success (real-text PDF)

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
		// resolver reads video/audio media?file= links server-side, so
		// their bytes never ride the JSON payload
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
	registerOdfExport("_office_presentationToPdf", func(jsonStr string) ([]byte, error) {
		pres, err := office.ParsePresentationJSON(jsonStr)
		if err != nil {
			return nil, err
		}
		return office.BuildSlidesPdf(pres)
	})

	vm.Run(`
		var office = {};

		office.pptxToPresentation = _office_pptxToPresentation;   // pptx file -> Slides body JSON string
		office.presentationToPptx = _office_presentationToPptx;   // Slides body JSON string -> pptx file (+ media sidecar zip; returns its vpath)
		office.xlsxToWorkbook = _office_xlsxToWorkbook;           // xlsx file -> Sheets body JSON string
		office.workbookToXlsx = _office_workbookToXlsx;           // Sheets body JSON string -> xlsx file
		office.docxToDocument = _office_docxToDocument;           // docx file -> Docs body JSON string
		office.documentToDocx = _office_documentToDocx;           // Docs body JSON string -> docx file
		office.packToFile = _office_packToFile;                   // envelope JSON -> native zip container file
		office.unpackFromFile = _office_unpackFromFile;           // container (or legacy JSON) file -> envelope JSON (data URLs)
		office.unpackToWorkdir = _office_unpackToWorkdir;         // container -> envelope JSON, assets extracted to a workdir

		office.odtToDocument = _office_odtToDocument;             // odt file -> Docs body JSON string
		office.documentToOdt = _office_documentToOdt;             // Docs body JSON string -> odt file
		office.odsToWorkbook = _office_odsToWorkbook;             // ods file -> Sheets body JSON string
		office.workbookToOds = _office_workbookToOds;             // Sheets body JSON string -> ods file
		office.odpToPresentation = _office_odpToPresentation;     // odp file -> Slides body JSON string
		office.presentationToOdp = _office_presentationToOdp;     // Slides body JSON string -> odp file

		office.documentToPdf = _office_documentToPdf;             // Docs body JSON string -> pdf file (real text)
		office.workbookPrintToPdf = _office_workbookPrintToPdf;   // Sheets print-model JSON -> pdf file (real text)
		office.presentationToPdf = _office_presentationToPdf;     // Slides body JSON string -> pdf file (real text)
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
