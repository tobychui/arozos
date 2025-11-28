package agi

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/mholt/archiver/v3"
	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
)

/*
	AGI Zip File View or Extract Library

	This library provide agi API for apps that want to view or extract agi zip files.

	Author: tobychui
*/

func (g *Gateway) ZipLibRegister() {
	err := g.RegisterLib("ziplib", g.injectZipFileLibFunctions)
	if err != nil {
		log.Fatal(err)
	}
}

func (g *Gateway) injectZipFileLibFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	u := payload.User
	scriptFsh := payload.ScriptFsh

	// extractZipFile(sourceVpath, destVpath) => Extract zip file to destination
	vm.Set("_ziplib_extractZipFile", func(call otto.FunctionCall) otto.Value {
		srcVpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		destVpath, err := call.Argument(1).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		// Rewrite paths if relative
		srcVpath = static.RelativeVpathRewrite(scriptFsh, srcVpath, vm, u)
		destVpath = static.RelativeVpathRewrite(scriptFsh, destVpath, vm, u)

		// Check permissions
		if !u.CanRead(srcVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+srcVpath))
		}
		if !u.CanWrite(destVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Write access denied: "+destVpath))
		}

		// Get real paths
		_, srcRpath, err := static.VirtualPathToRealPath(srcVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		destFsh, destRpath, err := static.VirtualPathToRealPath(destVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		// Extract using archiver
		z := archiver.Zip{}
		err = z.Unarchive(srcRpath, destRpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		// Update ownership
		destFsh.FileSystemAbstraction.Walk(destRpath, func(path string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() {
				vp, _ := static.RealpathToVirtualpath(destFsh, path, u)
				u.SetOwnerOfFile(destFsh, vp)
			}
			return nil
		})

		reply, _ := vm.ToValue(true)
		return reply
	})

	// createZipFile(sourceVpaths, outputVpath) => Create zip file from array of sources
	vm.Set("_ziplib_createZipFile", func(call otto.FunctionCall) otto.Value {
		sourcesObj, err := call.Argument(0).Export()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		outputVpath, err := call.Argument(1).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		// Convert sources to string array
		var sources []string
		switch v := sourcesObj.(type) {
		case []interface{}:
			for _, s := range v {
				if str, ok := s.(string); ok {
					sources = append(sources, static.RelativeVpathRewrite(scriptFsh, str, vm, u))
				}
			}
		case string:
			sources = append(sources, static.RelativeVpathRewrite(scriptFsh, v, vm, u))
		default:
			g.RaiseError(errors.New("invalid source format"))
			return otto.FalseValue()
		}

		outputVpath = static.RelativeVpathRewrite(scriptFsh, outputVpath, vm, u)

		// Check permissions
		for _, src := range sources {
			if !u.CanRead(src) {
				panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+src))
			}
		}
		if !u.CanWrite(outputVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Write access denied: "+outputVpath))
		}

		// Get real paths
		var sourceRpaths []string
		var sourceFshs []*filesystem.FileSystemHandler
		for _, src := range sources {
			fsh, rpath, err := static.VirtualPathToRealPath(src, u)
			if err != nil {
				g.RaiseError(err)
				return otto.FalseValue()
			}
			sourceFshs = append(sourceFshs, fsh)
			sourceRpaths = append(sourceRpaths, rpath)
		}

		outputFsh, outputRpath, err := static.VirtualPathToRealPath(outputVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		// Create zip file
		err = filesystem.ArozZipFile(sourceFshs, sourceRpaths, outputFsh, outputRpath, false)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		// Set ownership
		u.SetOwnerOfFile(outputFsh, outputVpath)

		reply, _ := vm.ToValue(true)
		return reply
	})

	// createTarFile(sourceVpaths, outputVpath) => Create tar file
	vm.Set("_ziplib_createTarFile", func(call otto.FunctionCall) otto.Value {
		sourcesObj, err := call.Argument(0).Export()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		outputVpath, err := call.Argument(1).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		var sources []string
		switch v := sourcesObj.(type) {
		case []interface{}:
			for _, s := range v {
				if str, ok := s.(string); ok {
					sources = append(sources, static.RelativeVpathRewrite(scriptFsh, str, vm, u))
				}
			}
		case string:
			sources = append(sources, static.RelativeVpathRewrite(scriptFsh, v, vm, u))
		}

		outputVpath = static.RelativeVpathRewrite(scriptFsh, outputVpath, vm, u)

		for _, src := range sources {
			if !u.CanRead(src) {
				panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+src))
			}
		}
		if !u.CanWrite(outputVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Write access denied: "+outputVpath))
		}

		var sourceRpaths []string
		for _, src := range sources {
			_, rpath, err := static.VirtualPathToRealPath(src, u)
			if err != nil {
				g.RaiseError(err)
				return otto.FalseValue()
			}
			sourceRpaths = append(sourceRpaths, rpath)
		}

		outputFsh, outputRpath, err := static.VirtualPathToRealPath(outputVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		tar := archiver.Tar{}
		err = tar.Archive(sourceRpaths, outputRpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		u.SetOwnerOfFile(outputFsh, outputVpath)

		reply, _ := vm.ToValue(true)
		return reply
	})

	// extractTarFile(sourceVpath, destVpath) => Extract tar file
	vm.Set("_ziplib_extractTarFile", func(call otto.FunctionCall) otto.Value {
		srcVpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		destVpath, err := call.Argument(1).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		srcVpath = static.RelativeVpathRewrite(scriptFsh, srcVpath, vm, u)
		destVpath = static.RelativeVpathRewrite(scriptFsh, destVpath, vm, u)

		if !u.CanRead(srcVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+srcVpath))
		}
		if !u.CanWrite(destVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Write access denied: "+destVpath))
		}

		_, srcRpath, err := static.VirtualPathToRealPath(srcVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		destFsh, destRpath, err := static.VirtualPathToRealPath(destVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		tar := archiver.Tar{}
		err = tar.Unarchive(srcRpath, destRpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		// Update ownership
		destFsh.FileSystemAbstraction.Walk(destRpath, func(path string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() {
				vp, _ := static.RealpathToVirtualpath(destFsh, path, u)
				u.SetOwnerOfFile(destFsh, vp)
			}
			return nil
		})

		reply, _ := vm.ToValue(true)
		return reply
	})

	// createTarGzFile(sourceVpaths, outputVpath) => Create tar.gz file
	vm.Set("_ziplib_createTarGzFile", func(call otto.FunctionCall) otto.Value {
		sourcesObj, err := call.Argument(0).Export()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		outputVpath, err := call.Argument(1).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		var sources []string
		switch v := sourcesObj.(type) {
		case []interface{}:
			for _, s := range v {
				if str, ok := s.(string); ok {
					sources = append(sources, static.RelativeVpathRewrite(scriptFsh, str, vm, u))
				}
			}
		case string:
			sources = append(sources, static.RelativeVpathRewrite(scriptFsh, v, vm, u))
		}

		outputVpath = static.RelativeVpathRewrite(scriptFsh, outputVpath, vm, u)

		for _, src := range sources {
			if !u.CanRead(src) {
				panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+src))
			}
		}
		if !u.CanWrite(outputVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Write access denied: "+outputVpath))
		}

		var sourceRpaths []string
		for _, src := range sources {
			_, rpath, err := static.VirtualPathToRealPath(src, u)
			if err != nil {
				g.RaiseError(err)
				return otto.FalseValue()
			}
			sourceRpaths = append(sourceRpaths, rpath)
		}

		outputFsh, outputRpath, err := static.VirtualPathToRealPath(outputVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		tgz := archiver.TarGz{}
		err = tgz.Archive(sourceRpaths, outputRpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		u.SetOwnerOfFile(outputFsh, outputVpath)

		reply, _ := vm.ToValue(true)
		return reply
	})

	// extractTarGzFile(sourceVpath, destVpath) => Extract tar.gz file
	vm.Set("_ziplib_extractTarGzFile", func(call otto.FunctionCall) otto.Value {
		srcVpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		destVpath, err := call.Argument(1).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		srcVpath = static.RelativeVpathRewrite(scriptFsh, srcVpath, vm, u)
		destVpath = static.RelativeVpathRewrite(scriptFsh, destVpath, vm, u)

		if !u.CanRead(srcVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+srcVpath))
		}
		if !u.CanWrite(destVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Write access denied: "+destVpath))
		}

		_, srcRpath, err := static.VirtualPathToRealPath(srcVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		destFsh, destRpath, err := static.VirtualPathToRealPath(destVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		tgz := archiver.TarGz{}
		err = tgz.Unarchive(srcRpath, destRpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		// Update ownership
		destFsh.FileSystemAbstraction.Walk(destRpath, func(path string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() {
				vp, _ := static.RealpathToVirtualpath(destFsh, path, u)
				u.SetOwnerOfFile(destFsh, vp)
			}
			return nil
		})

		reply, _ := vm.ToValue(true)
		return reply
	})

	// createGzFile(sourceVpath, outputVpath) => Create gz file (single file compression)
	vm.Set("_ziplib_createGzFile", func(call otto.FunctionCall) otto.Value {
		srcVpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		outputVpath, err := call.Argument(1).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		srcVpath = static.RelativeVpathRewrite(scriptFsh, srcVpath, vm, u)
		outputVpath = static.RelativeVpathRewrite(scriptFsh, outputVpath, vm, u)

		if !u.CanRead(srcVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+srcVpath))
		}
		if !u.CanWrite(outputVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Write access denied: "+outputVpath))
		}

		srcFsh, srcRpath, err := static.VirtualPathToRealPath(srcVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		outputFsh, outputRpath, err := static.VirtualPathToRealPath(outputVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		// Compress using Gz - open source file and create output file
		srcFile, err := srcFsh.FileSystemAbstraction.ReadStream(srcRpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		defer srcFile.Close()

		outFile, err := outputFsh.FileSystemAbstraction.Create(outputRpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		defer outFile.Close()

		gz := archiver.Gz{}
		err = gz.Compress(srcFile, outFile)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		u.SetOwnerOfFile(outputFsh, outputVpath)

		reply, _ := vm.ToValue(true)
		return reply
	})

	// extractGzFile(sourceVpath, destVpath) => Extract gz file
	vm.Set("_ziplib_extractGzFile", func(call otto.FunctionCall) otto.Value {
		srcVpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		destVpath, err := call.Argument(1).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		srcVpath = static.RelativeVpathRewrite(scriptFsh, srcVpath, vm, u)
		destVpath = static.RelativeVpathRewrite(scriptFsh, destVpath, vm, u)

		if !u.CanRead(srcVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+srcVpath))
		}
		if !u.CanWrite(destVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Write access denied: "+destVpath))
		}

		srcFsh, srcRpath, err := static.VirtualPathToRealPath(srcVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		destFsh, destRpath, err := static.VirtualPathToRealPath(destVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		// Decompress using Gz - open source file and create output file
		srcFile, err := srcFsh.FileSystemAbstraction.ReadStream(srcRpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		defer srcFile.Close()

		outFile, err := destFsh.FileSystemAbstraction.Create(destRpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		defer outFile.Close()

		gz := archiver.Gz{}
		err = gz.Decompress(srcFile, outFile)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		u.SetOwnerOfFile(destFsh, destVpath)

		reply, _ := vm.ToValue(true)
		return reply
	})

	// isValidZipFile(vpath) => Check if file is a valid archive (zip, tar, tar.gz, gz, etc.)
	vm.Set("_ziplib_isValidZipFile", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

		if !u.CanRead(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+vpath))
		}

		_, rpath, err := static.VirtualPathToRealPath(vpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		// Try to detect format using archiver library
		_, err = archiver.ByExtension(rpath)
		if err != nil {
			// Try by header
			f, err := os.Open(rpath)
			if err != nil {
				reply, _ := vm.ToValue(false)
				return reply
			}
			_, err = archiver.ByHeader(f)
			f.Close()
			if err != nil {
				reply, _ := vm.ToValue(false)
				return reply
			}
		}

		reply, _ := vm.ToValue(true)
		return reply
	})

	// listZipFileContents(vpath) => List contents of zip in json tree structure
	vm.Set("_ziplib_listZipFileContents", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

		if !u.CanRead(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+vpath))
		}

		_, rpath, err := static.VirtualPathToRealPath(vpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		r, err := zip.OpenReader(rpath)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		defer r.Close()

		// Build tree structure
		type Node struct {
			Name     string           `json:"name"`
			IsDir    bool             `json:"isDir"`
			Size     int64            `json:"size"`
			Children map[string]*Node `json:"children,omitempty"`
		}

		root := &Node{
			Name:     "/",
			IsDir:    true,
			Children: make(map[string]*Node),
		}

		for _, f := range r.File {
			parts := strings.Split(filepath.ToSlash(f.Name), "/")
			current := root

			for i, part := range parts {
				if part == "" {
					continue
				}

				isLast := i == len(parts)-1
				if current.Children == nil {
					current.Children = make(map[string]*Node)
				}

				if _, exists := current.Children[part]; !exists {
					current.Children[part] = &Node{
						Name:  part,
						IsDir: !isLast || f.FileInfo().IsDir(),
					}
					if isLast && !f.FileInfo().IsDir() {
						current.Children[part].Size = int64(f.UncompressedSize64)
					}
				}
				current = current.Children[part]
			}
		}

		jsonData, err := json.Marshal(root)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		reply, _ := vm.ToValue(string(jsonData))
		return reply
	})

	// listZipFileDir(zipVpath, dirPath) => List contents of specific directory in zip
	vm.Set("_ziplib_listZipFileDir", func(call otto.FunctionCall) otto.Value {
		zipVpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		dirPath, err := call.Argument(1).ToString()
		if err != nil {
			// Default to root if not provided
			dirPath = ""
		}

		zipVpath = static.RelativeVpathRewrite(scriptFsh, zipVpath, vm, u)

		if !u.CanRead(zipVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+zipVpath))
		}

		_, zipRpath, err := static.VirtualPathToRealPath(zipVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		// Open zip file
		r, err := zip.OpenReader(zipRpath)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		defer r.Close()

		// Normalize the directory path
		dirPath = filepath.ToSlash(strings.TrimPrefix(dirPath, "/"))
		if dirPath != "" && !strings.HasSuffix(dirPath, "/") {
			dirPath = dirPath + "/"
		}

		// Check if directory exists and collect immediate children
		var filelist []string
		dirExists := dirPath == "" // root always exists
		seenItems := make(map[string]bool)

		for _, f := range r.File {
			fName := filepath.ToSlash(f.Name)

			// Check if this file is in the target directory
			if dirPath == "" {
				// List root level items
				parts := strings.Split(fName, "/")
				if len(parts) > 0 {
					item := parts[0]
					if item != "" && !seenItems[item] {
						seenItems[item] = true
						// Check if it's a directory
						if len(parts) > 1 || f.FileInfo().IsDir() {
							filelist = append(filelist, item+"/")
						} else {
							filelist = append(filelist, item)
						}
					}
				}
			} else if strings.HasPrefix(fName, dirPath) {
				// Mark directory as existing
				dirExists = true

				// Get the relative path from the directory
				relPath := strings.TrimPrefix(fName, dirPath)
				if relPath != "" {
					parts := strings.Split(relPath, "/")
					if len(parts) > 0 {
						item := parts[0]
						if item != "" && !seenItems[item] {
							seenItems[item] = true
							// Check if it's a directory (has more parts or is a dir entry)
							if len(parts) > 1 || (len(parts) == 1 && strings.HasSuffix(relPath, "/")) {
								filelist = append(filelist, item+"/")
							} else {
								filelist = append(filelist, item)
							}
						}
					}
				}
			}
		}

		// If directory path was specified but doesn't exist, return error
		if dirPath != "" && !dirExists {
			g.RaiseError(errors.New("Directory not found in zip: " + dirPath))
			return otto.NullValue()
		}

		reply, _ := vm.ToValue(filelist)
		return reply
	})

	// getFileFromZip(zipVpath, filePathInZip) => Extract specific file from zip to tmp:/
	vm.Set("_ziplib_getFileFromZip", func(call otto.FunctionCall) otto.Value {
		zipVpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		fileInZip, err := call.Argument(1).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		zipVpath = static.RelativeVpathRewrite(scriptFsh, zipVpath, vm, u)

		if !u.CanRead(zipVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+zipVpath))
		}

		_, zipRpath, err := static.VirtualPathToRealPath(zipVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		// Open zip file
		r, err := zip.OpenReader(zipRpath)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		defer r.Close()

		// Find the file in zip
		var targetFile *zip.File
		for _, f := range r.File {
			if filepath.ToSlash(f.Name) == filepath.ToSlash(fileInZip) {
				targetFile = f
				break
			}
		}

		if targetFile == nil {
			g.RaiseError(errors.New("File not found in zip: " + fileInZip))
			return otto.NullValue()
		}

		// Extract to tmp
		tmpFsh, err := u.GetFileSystemHandlerFromVirtualPath("tmp:/")
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		tmpFilename := arozfs.Base(fileInZip)
		tmpVpath := "tmp:/" + tmpFilename
		tmpRpath, _ := tmpFsh.FileSystemAbstraction.VirtualPathToRealPath(tmpVpath, u.Username)

		rc, err := targetFile.Open()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		defer rc.Close()

		err = tmpFsh.FileSystemAbstraction.WriteStream(tmpRpath, rc, 0755)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		u.SetOwnerOfFile(tmpFsh, tmpVpath)

		reply, _ := vm.ToValue(tmpVpath)
		return reply
	})

	// getCompressFileType(vpath) => Detect compression type
	vm.Set("_ziplib_getCompressFileType", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

		if !u.CanRead(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+vpath))
		}

		_, rpath, err := static.VirtualPathToRealPath(vpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		// Check file extension and magic bytes
		ext := strings.ToLower(filepath.Ext(rpath))
		fileType := "unknown"

		switch ext {
		case ".zip":
			fileType = "zip"
		case ".7z":
			fileType = "7z"
		case ".tar":
			fileType = "tar"
		case ".gz":
			// Check if it's tar.gz
			if strings.HasSuffix(strings.ToLower(rpath), ".tar.gz") || strings.HasSuffix(strings.ToLower(rpath), ".tgz") {
				fileType = "tar.gz"
			} else {
				fileType = "gz"
			}
		case ".tgz":
			fileType = "tar.gz"
		default:
			// Try to detect by magic bytes
			f, err := os.Open(rpath)
			if err == nil {
				defer f.Close()
				magic := make([]byte, 4)
				f.Read(magic)

				// Check magic bytes
				if magic[0] == 0x50 && magic[1] == 0x4B && (magic[2] == 0x03 || magic[2] == 0x05) {
					fileType = "zip"
				} else if magic[0] == 0x37 && magic[1] == 0x7A && magic[2] == 0xBC && magic[3] == 0xAF {
					fileType = "7z"
				} else if magic[0] == 0x1F && magic[1] == 0x8B {
					fileType = "gz"
				}
			}
		}

		reply, _ := vm.ToValue(fileType)
		return reply
	})

	// extractAnyFile(sourceVpath, destVpath) => Extract based on file type detection
	vm.Set("_ziplib_extractAnyFile", func(call otto.FunctionCall) otto.Value {
		srcVpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		destVpath, err := call.Argument(1).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		srcVpath = static.RelativeVpathRewrite(scriptFsh, srcVpath, vm, u)
		destVpath = static.RelativeVpathRewrite(scriptFsh, destVpath, vm, u)

		if !u.CanRead(srcVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+srcVpath))
		}
		if !u.CanWrite(destVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Write access denied: "+destVpath))
		}

		_, srcRpath, err := static.VirtualPathToRealPath(srcVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		destFsh, destRpath, err := static.VirtualPathToRealPath(destVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		// Detect format
		format, err := archiver.ByExtension(srcRpath)
		if err != nil {
			// Try by header
			f, err := os.Open(srcRpath)
			if err != nil {
				g.RaiseError(err)
				return otto.FalseValue()
			}
			format, err = archiver.ByHeader(f)
			f.Close()
			if err != nil {
				g.RaiseError(err)
				return otto.FalseValue()
			}
		}

		// Extract using appropriate archiver
		if u, ok := format.(archiver.Unarchiver); ok {
			err = u.Unarchive(srcRpath, destRpath)
			if err != nil {
				g.RaiseError(err)
				return otto.FalseValue()
			}
		} else {
			g.RaiseError(errors.New("format does not support extraction"))
			return otto.FalseValue()
		}

		// Update ownership
		destFsh.FileSystemAbstraction.Walk(destRpath, func(path string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() {
				vp, _ := static.RealpathToVirtualpath(destFsh, path, u)
				u.SetOwnerOfFile(destFsh, vp)
			}
			return nil
		})

		reply, _ := vm.ToValue(true)
		return reply
	})

	// createAnyZipFile(sourceVpaths, outputVpath, format) => Create archive based on format
	vm.Set("_ziplib_createAnyZipFile", func(call otto.FunctionCall) otto.Value {
		sourcesObj, err := call.Argument(0).Export()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		outputVpath, err := call.Argument(1).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		format, err := call.Argument(2).ToString()
		if err != nil {
			// Default to zip
			format = "zip"
		}

		var sources []string
		switch v := sourcesObj.(type) {
		case []interface{}:
			for _, s := range v {
				if str, ok := s.(string); ok {
					sources = append(sources, static.RelativeVpathRewrite(scriptFsh, str, vm, u))
				}
			}
		case string:
			sources = append(sources, static.RelativeVpathRewrite(scriptFsh, v, vm, u))
		}

		outputVpath = static.RelativeVpathRewrite(scriptFsh, outputVpath, vm, u)

		for _, src := range sources {
			if !u.CanRead(src) {
				panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+src))
			}
		}
		if !u.CanWrite(outputVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Write access denied: "+outputVpath))
		}

		var sourceRpaths []string
		for _, src := range sources {
			_, rpath, err := static.VirtualPathToRealPath(src, u)
			if err != nil {
				g.RaiseError(err)
				return otto.FalseValue()
			}
			sourceRpaths = append(sourceRpaths, rpath)
		}

		outputFsh, outputRpath, err := static.VirtualPathToRealPath(outputVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		// Create archive based on format
		switch strings.ToLower(format) {
		case "zip":
			z := &archiver.Zip{}
			err = z.Archive(sourceRpaths, outputRpath)
		case "tar":
			tar := &archiver.Tar{}
			err = tar.Archive(sourceRpaths, outputRpath)
		case "tar.gz", "tgz", "targz":
			tgz := &archiver.TarGz{}
			err = tgz.Archive(sourceRpaths, outputRpath)
		case "gz", "gzip":
			g.RaiseError(errors.New("gz format requires createGzFile for single file compression"))
			return otto.FalseValue()
		default:
			g.RaiseError(errors.New("unsupported format: " + format))
			return otto.FalseValue()
		}
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		u.SetOwnerOfFile(outputFsh, outputVpath)

		reply, _ := vm.ToValue(true)
		return reply
	})

	vm.Run(`
		var ziplib = {};
		
		ziplib.extractZipFile = _ziplib_extractZipFile;
		ziplib.createZipFile = _ziplib_createZipFile;
		ziplib.createTarFile = _ziplib_createTarFile;
		ziplib.extractTarFile = _ziplib_extractTarFile;
		ziplib.createTarGzFile = _ziplib_createTarGzFile;
		ziplib.extractTarGzFile = _ziplib_extractTarGzFile;
		ziplib.createGzFile = _ziplib_createGzFile;
		ziplib.extractGzFile = _ziplib_extractGzFile;

		// Generic functions
		ziplib.isValidZipFile = _ziplib_isValidZipFile; // Check if file is valid archive file (zip, tar, tar.gz, gz)
		ziplib.listZipFileContents = _ziplib_listZipFileContents; // List contents of zip in json tree structure
		ziplib.listZipFileDir = _ziplib_listZipFileDir; // List contents of specific directory in zip
		ziplib.getFileFromZip = _ziplib_getFileFromZip; // Get specific file from zip, stored temporary at tmp:/
		ziplib.getCompressFileType = _ziplib_getCompressFileType;
		ziplib.extractAnyFile = _ziplib_extractAnyFile; // Extract zip, tar, targz, gz based on file type
		ziplib.createAnyZipFile = _ziplib_createAnyZipFile; // Create zip, tar, targz, gz based on input
	`)
}

/*
	Example Usages

	// Extract a zip file to a destination folder
	ziplib.extractZipFile("user:/documents/archive.zip", "user:/documents/extracted/");

	// Create a zip file from multiple sources
	ziplib.createZipFile(["user:/documents/file1.txt", "user:/documents/file2.txt"], "user:/backup.zip");
	ziplib.createZipFile("user:/documents/single_file.txt", "user:/output.zip"); // Single file

	// Create and extract tar archives
	ziplib.createTarFile(["user:/data/folder1", "user:/data/folder2"], "user:/archive.tar");
	ziplib.extractTarFile("user:/downloads/archive.tar", "user:/extracted/");

	// Create and extract tar.gz archives
	ziplib.createTarGzFile(["user:/logs/"], "user:/backup/logs.tar.gz");
	ziplib.extractTarGzFile("user:/downloads/backup.tar.gz", "user:/restore/");

	// Compress and decompress single files with gzip
	ziplib.createGzFile("user:/documents/large_file.txt", "user:/compressed/large_file.txt.gz");
	ziplib.extractGzFile("user:/compressed/data.gz", "user:/decompressed/data");

	// Check if a file is a valid archive (supports zip, tar, tar.gz, gz)
	if (ziplib.isValidZipFile("user:/downloads/file.zip")) {
		console.log("Valid archive file");
	}
	if (ziplib.isValidZipFile("user:/downloads/backup.tar.gz")) {
		console.log("Valid tar.gz archive");
	}

	// List zip contents as JSON tree structure
	var contents = JSON.parse(ziplib.listZipFileContents("user:/archive.zip"));
	console.log(contents); // Returns nested tree structure with files and folders

	// List root contents of zip
	var rootFiles = ziplib.listZipFileDir("user:/archive.zip", "");
	console.log(rootFiles); // Returns ["folder1/", "folder2/", "file.txt"]

	// List contents of specific folder in zip
	var folderContents = ziplib.listZipFileDir("user:/archive.zip", "folder1");
	console.log(folderContents); // Returns ["subfolder/", "file1.txt", "file2.txt"]

	// List contents with path
	var deepContents = ziplib.listZipFileDir("user:/archive.zip", "folder1/subfolder");
	console.log(deepContents); // Returns only immediate children of folder1/subfolder/	// Extract a specific file from zip to tmp:/
	var tmpPath = ziplib.getFileFromZip("user:/archive.zip", "folder1/important.txt");
	console.log("File extracted to: " + tmpPath); // Returns "tmp:/important.txt"

	// Detect compression type
	var type = ziplib.getCompressFileType("user:/unknown_file.archive");
	console.log("Archive type: " + type); // Returns "zip", "tar", "tar.gz", "gz", or "unknown"

	// Extract any supported archive format (auto-detect)
	ziplib.extractAnyFile("user:/downloads/archive.unknown", "user:/extracted/");

	// Create archive with specific format
	ziplib.createAnyZipFile(["user:/data/"], "user:/backup.zip", "zip");
	ziplib.createAnyZipFile(["user:/data/"], "user:/backup.tar", "tar");
	ziplib.createAnyZipFile(["user:/data/"], "user:/backup.tar.gz", "tar.gz");

	// Error handling examples
	try {
		ziplib.extractZipFile("user:/nonexistent.zip", "user:/output/");
	} catch (e) {
		console.log("Error: " + e.message);
	}

	// Working with relative paths (when script is in user:/scripts/)
	ziplib.createZipFile(["../documents/data.txt"], "../backup.zip"); // Relative to script location

	// Batch operations
	var filesToZip = [
		"user:/documents/report.pdf",
		"user:/documents/data.csv",
		"user:/documents/images/"
	];
	ziplib.createZipFile(filesToZip, "user:/archive/batch_backup.zip");
*/
