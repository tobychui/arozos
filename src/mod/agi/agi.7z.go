package agi

/*
	AGI 7-Zip Library Extension

	Adds 7z archive support to the ziplib namespace.
	Call inject7zLibFunctions from injectZipFileLibFunctions (after the main
	vm.Run that creates the ziplib object) so the bindings can extend it.

	Depends on github.com/bodgit/sevenzip (BSD-3-Clause).
*/

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/bodgit/sevenzip"
	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
)

// inject7zLibFunctions registers all 7z functions into the ziplib JS namespace.
// Must be called after the main vm.Run block that creates `var ziplib = {}`.
func (g *Gateway) inject7zLibFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	u := payload.User
	scriptFsh := payload.ScriptFsh

	// list7zFileDir(srcVpath, dirPath) → string[]
	// List the immediate children of a directory inside a 7z archive.
	vm.Set("_ziplib_list7zFileDir", func(call otto.FunctionCall) otto.Value {
		zipVpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		dirPath, err := call.Argument(1).ToString()
		if err != nil {
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

		filelist, err := szListDir(zipRpath, dirPath)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		reply, _ := vm.ToValue(filelist)
		return reply
	})

	// list7zFileContents(srcVpath) → JSON string (tree)
	// Return the full JSON tree of all entries in a 7z archive.
	vm.Set("_ziplib_list7zFileContents", func(call otto.FunctionCall) otto.Value {
		zipVpath, err := call.Argument(0).ToString()
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

		jsonStr, err := sz7zListContentsJSON(zipRpath)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		reply, _ := vm.ToValue(jsonStr)
		return reply
	})

	// getFileFrom7z(srcVpath, filePathIn7z) → vpath of extracted file in tmp:/
	// Extract a single file from a 7z archive to a temporary location.
	vm.Set("_ziplib_getFileFrom7z", func(call otto.FunctionCall) otto.Value {
		zipVpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		fileIn7z, err := call.Argument(1).ToString()
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

		r, err := sevenzip.OpenReader(zipRpath)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		defer r.Close()

		var target *sevenzip.File
		for _, f := range r.File {
			if filepath.ToSlash(f.Name) == filepath.ToSlash(fileIn7z) {
				target = f
				break
			}
		}
		if target == nil {
			g.RaiseError(errors.New("File not found in archive: " + fileIn7z))
			return otto.NullValue()
		}

		tmpFsh, err := u.GetFileSystemHandlerFromVirtualPath("tmp:/")
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		tmpFilename := arozfs.Base(fileIn7z)
		tmpVpath := "tmp:/" + tmpFilename
		tmpRpath, _ := tmpFsh.FileSystemAbstraction.VirtualPathToRealPath(tmpVpath, u.Username)

		rc, err := target.Open()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		defer rc.Close()

		if err = tmpFsh.FileSystemAbstraction.WriteStream(tmpRpath, rc, 0755); err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		u.SetOwnerOfFile(tmpFsh, tmpVpath)
		reply, _ := vm.ToValue(tmpVpath)
		return reply
	})

	// extract7zFile(srcVpath, destVpath) → bool
	// Extract all files from a 7z archive to destVpath.
	vm.Set("_ziplib_extract7zFile", func(call otto.FunctionCall) otto.Value {
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

		if err = sz7zExtractAll(srcRpath, destFsh, destRpath); err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		destFsh.FileSystemAbstraction.Walk(destRpath, func(path string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() {
				vp, e := static.RealpathToVirtualpath(destFsh, path, u)
				if e == nil {
					u.SetOwnerOfFile(destFsh, vp)
				}
			}
			return nil
		})

		reply, _ := vm.ToValue(true)
		return reply
	})

	// extractPartial7z(srcVpath, filePathsIn7z, destVpath) → bool
	// Extract selected files/folders from a 7z archive; strips parent prefix for
	// folder selections, extracts flat for file selections (same semantics as
	// extractPartialZip).
	vm.Set("_ziplib_extractPartial7z", func(call otto.FunctionCall) otto.Value {
		zipVpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		pathsObj, err := call.Argument(1).Export()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		destVpath, err := call.Argument(2).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		zipVpath = static.RelativeVpathRewrite(scriptFsh, zipVpath, vm, u)
		destVpath = static.RelativeVpathRewrite(scriptFsh, destVpath, vm, u)

		targetPaths := szParsePathsArg(pathsObj)
		if targetPaths == nil {
			g.RaiseError(errors.New("invalid paths format"))
			return otto.FalseValue()
		}

		if !u.CanRead(zipVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Read access denied: "+zipVpath))
		}
		if !u.CanWrite(destVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Write access denied: "+destVpath))
		}

		_, zipRpath, err := static.VirtualPathToRealPath(zipVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		destFsh, destRpath, err := static.VirtualPathToRealPath(destVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		r, err := sevenzip.OpenReader(zipRpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		defer r.Close()

		for _, f := range r.File {
			outRelPath := szMatchPartialPath(filepath.ToSlash(f.Name), targetPaths)
			if outRelPath == "" {
				continue
			}

			outPath := filepath.Join(destRpath, filepath.FromSlash(outRelPath))
			if f.FileInfo().IsDir() {
				destFsh.FileSystemAbstraction.MkdirAll(outPath, 0755)
				continue
			}
			destFsh.FileSystemAbstraction.MkdirAll(filepath.Dir(outPath), 0755)

			rc, err := f.Open()
			if err != nil {
				continue
			}
			destFsh.FileSystemAbstraction.WriteStream(outPath, rc, 0755)
			rc.Close()

			vp, err := static.RealpathToVirtualpath(destFsh, outPath, u)
			if err == nil {
				u.SetOwnerOfFile(destFsh, vp)
			}
		}

		reply, _ := vm.ToValue(true)
		return reply
	})

	// get7zFileInfo(srcVpath) → JSON string {fileCount, dirCount, totalUncompressedSize, totalCompressedSize}
	vm.Set("_ziplib_get7zFileInfo", func(call otto.FunctionCall) otto.Value {
		zipVpath, err := call.Argument(0).ToString()
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

		jsonStr, err := sz7zGetFileInfo(zipRpath)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		reply, _ := vm.ToValue(jsonStr)
		return reply
	})

	vm.Run(`
		// 7z-specific functions
		ziplib.extract7zFile         = _ziplib_extract7zFile;         // Extract all files from a 7z archive
		ziplib.list7zFileDir         = _ziplib_list7zFileDir;         // List immediate children of a dir in 7z
		ziplib.list7zFileContents    = _ziplib_list7zFileContents;    // Full JSON tree of a 7z archive
		ziplib.getFileFrom7z         = _ziplib_getFileFrom7z;         // Extract single file from 7z to tmp:/
		ziplib.extractPartial7z      = _ziplib_extractPartial7z;      // Extract selected files/folders from 7z
		ziplib.get7zFileInfo         = _ziplib_get7zFileInfo;         // Metadata (counts, sizes) of a 7z
	`)
}

// ── Package-level helpers (shared between inject7zLibFunctions and the
//    dispatch branches added to existing ziplib functions) ──────────────────

// szListDir returns the immediate children of dirPath inside the 7z at rpath.
// Handles archives without explicit directory entries by inferring dirs from
// file paths (common in 7z).
func szListDir(rpath, dirPath string) ([]string, error) {
	r, err := sevenzip.OpenReader(rpath)
	if err != nil {
		return nil, err
	}
	defer r.Close()

	dirPath = filepath.ToSlash(strings.TrimPrefix(dirPath, "/"))
	if dirPath != "" && !strings.HasSuffix(dirPath, "/") {
		dirPath += "/"
	}

	var filelist []string
	dirExists := dirPath == ""
	seenItems := make(map[string]bool)

	for _, f := range r.File {
		fName := filepath.ToSlash(f.Name)

		if dirPath == "" {
			parts := strings.Split(fName, "/")
			if len(parts) == 0 {
				continue
			}
			item := parts[0]
			if item == "" || seenItems[item] {
				continue
			}
			seenItems[item] = true
			if len(parts) > 1 || f.FileInfo().IsDir() {
				filelist = append(filelist, item+"/")
			} else {
				filelist = append(filelist, item)
			}
		} else if strings.HasPrefix(fName, dirPath) {
			dirExists = true
			relPath := strings.TrimPrefix(fName, dirPath)
			if relPath == "" {
				continue
			}
			parts := strings.Split(relPath, "/")
			item := parts[0]
			if item == "" || seenItems[item] {
				continue
			}
			seenItems[item] = true
			if len(parts) > 1 || strings.HasSuffix(relPath, "/") || f.FileInfo().IsDir() {
				filelist = append(filelist, item+"/")
			} else {
				filelist = append(filelist, item)
			}
		}
	}

	if dirPath != "" && !dirExists {
		return nil, errors.New("Directory not found in archive: " + dirPath)
	}
	return filelist, nil
}

// sz7zListContentsJSON builds a JSON tree (same schema as listZipFileContents)
// from all entries in the 7z archive at rpath.
func sz7zListContentsJSON(rpath string) (string, error) {
	r, err := sevenzip.OpenReader(rpath)
	if err != nil {
		return "", err
	}
	defer r.Close()

	type Node struct {
		Name     string           `json:"name"`
		IsDir    bool             `json:"isDir"`
		Size     int64            `json:"size"`
		Children map[string]*Node `json:"children,omitempty"`
	}
	root := &Node{Name: "/", IsDir: true, Children: make(map[string]*Node)}

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
					current.Children[part].Size = f.FileInfo().Size()
				}
			}
			current = current.Children[part]
		}
	}

	data, err := json.Marshal(root)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// sz7zGetFileInfo returns JSON metadata for the 7z archive at rpath.
func sz7zGetFileInfo(rpath string) (string, error) {
	r, err := sevenzip.OpenReader(rpath)
	if err != nil {
		return "", err
	}
	defer r.Close()

	type Info struct {
		FileCount             int   `json:"fileCount"`
		DirCount              int   `json:"dirCount"`
		TotalUncompressedSize int64 `json:"totalUncompressedSize"`
		TotalCompressedSize   int64 `json:"totalCompressedSize"` // always 0: 7z uses solid compression
	}
	info := Info{}
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			info.DirCount++
		} else {
			info.FileCount++
			info.TotalUncompressedSize += f.FileInfo().Size()
		}
	}

	data, err := json.Marshal(info)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// sz7zExtractAll extracts every entry in the 7z at srcRpath into destRpath
// using the provided filesystem handler.
func sz7zExtractAll(srcRpath string, destFsh *filesystem.FileSystemHandler, destRpath string) error {
	r, err := sevenzip.OpenReader(srcRpath)
	if err != nil {
		return err
	}
	defer r.Close()

	for _, f := range r.File {
		fName := filepath.ToSlash(f.Name)
		outPath := filepath.Join(destRpath, filepath.FromSlash(fName))

		if f.FileInfo().IsDir() {
			destFsh.FileSystemAbstraction.MkdirAll(outPath, 0755)
			continue
		}
		destFsh.FileSystemAbstraction.MkdirAll(filepath.Dir(outPath), 0755)

		rc, err := f.Open()
		if err != nil {
			continue
		}
		destFsh.FileSystemAbstraction.WriteStream(outPath, rc, 0755)
		rc.Close()
	}
	return nil
}

// szParsePathsArg converts the second argument of extractPartial7z / extractPartialZip
// (JS array or raw JSON string) into a []string.  Returns nil on unrecognised type.
func szParsePathsArg(pathsObj interface{}) []string {
	var result []string
	switch v := pathsObj.(type) {
	case []interface{}:
		for _, s := range v {
			if str, ok := s.(string); ok {
				result = append(result, filepath.ToSlash(strings.TrimPrefix(str, "/")))
			}
		}
	case string:
		v = strings.TrimSpace(v)
		if strings.HasPrefix(v, "[") {
			var arr []string
			if json.Unmarshal([]byte(v), &arr) == nil {
				for _, s := range arr {
					result = append(result, filepath.ToSlash(strings.TrimPrefix(s, "/")))
				}
				return result
			}
		}
		if v != "" {
			result = append(result, filepath.ToSlash(strings.TrimPrefix(v, "/")))
		}
	default:
		return nil
	}
	return result
}

// szMatchPartialPath returns the output-relative path for fName given the list
// of selected targetPaths, applying the same strip-parent-for-folders /
// flatten-for-files semantics as extractPartialZip.  Returns "" if not matched.
func szMatchPartialPath(fName string, targetPaths []string) string {
	for _, target := range targetPaths {
		if target == "" || target == "/" {
			return fName
		}
		isFolderTarget := strings.HasSuffix(target, "/")
		normalizedTarget := strings.TrimSuffix(target, "/")

		if isFolderTarget {
			if strings.HasPrefix(fName, target) || fName == target || fName == normalizedTarget {
				lastSlash := strings.LastIndex(normalizedTarget, "/")
				parent := ""
				if lastSlash >= 0 {
					parent = normalizedTarget[:lastSlash+1]
				}
				return strings.TrimPrefix(fName, parent)
			}
		} else {
			if fName == target {
				return filepath.Base(fName)
			}
			if strings.HasPrefix(fName, normalizedTarget+"/") {
				lastSlash := strings.LastIndex(normalizedTarget, "/")
				parent := ""
				if lastSlash >= 0 {
					parent = normalizedTarget[:lastSlash+1]
				}
				return strings.TrimPrefix(fName, parent)
			}
		}
	}
	return ""
}
