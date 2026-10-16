package agi

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"io"
	"os"
	"path"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
)

// exportJS evaluates a JS expression and returns its exported Go value, which
// is exactly what the ziplib functions receive from call.Argument(n).Export().
func exportJS(t *testing.T, expr string) interface{} {
	t.Helper()
	val, err := otto.New().Run("(" + expr + ")")
	if err != nil {
		t.Fatalf("evaluating %s: %v", expr, err)
	}
	exported, err := val.Export()
	if err != nil {
		t.Fatalf("exporting %s: %v", expr, err)
	}
	return exported
}

func TestZiplibSourceList(t *testing.T) {
	cases := []struct {
		name   string
		expr   string
		want   []string
		wantOK bool
	}{
		{"array of strings", `["user:/a.txt", "user:/b.txt"]`, []string{"user:/a.txt", "user:/b.txt"}, true},
		{"array of one string", `["user:/a.txt"]`, []string{"user:/a.txt"}, true},
		{"empty array", `[]`, []string{}, true},
		{"mixed array keeps the strings", `["user:/a.txt", 1, null]`, []string{"user:/a.txt"}, true},
		{"single string", `"user:/a.txt"`, []string{"user:/a.txt"}, true},
		{"undefined", `undefined`, nil, false},
		{"number", `42`, nil, false},
		{"array of numbers", `[1, 2]`, nil, false},
		{"object", `({a: "user:/a.txt"})`, nil, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := ziplibSourceList(exportJS(t, c.expr))
			if ok != c.wantOK {
				t.Fatalf("ok = %v, want %v", ok, c.wantOK)
			}
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("sources = %#v, want %#v", got, c.want)
			}
		})
	}
}

// The returned list is rewritten in place by the callers, so it must not share
// its backing array with the exported argument.
func TestZiplibSourceListCopiesInput(t *testing.T) {
	in := []string{"user:/a.txt"}
	got, _ := ziplibSourceList(in)
	got[0] = "changed"
	if in[0] != "user:/a.txt" {
		t.Errorf("ziplibSourceList shares its result with the input slice")
	}
}

func TestSzParsePathsArg(t *testing.T) {
	cases := []struct {
		name string
		expr string
		want []string
	}{
		{"array of strings", `["docs/", "/a.txt"]`, []string{"docs/", "a.txt"}},
		{"mixed array keeps the strings", `["a.txt", 1]`, []string{"a.txt"}},
		{"JSON array string", `'["docs/", "/a.txt"]'`, []string{"docs/", "a.txt"}},
		{"single path string", `"/a.txt"`, []string{"a.txt"}},
		{"number", `42`, nil},
		{"undefined", `undefined`, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := szParsePathsArg(exportJS(t, c.expr))
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("szParsePathsArg(%s) = %#v, want %#v", c.expr, got, c.want)
			}
		})
	}
}

// newZipLibTestVM returns a VM with ziplib loaded for a user from newFsTestUser,
// with a.txt, b.txt and docs/c.txt in the user's storage.
func newZipLibTestVM(t *testing.T) (*otto.Otto, string) {
	t.Helper()
	u, dir := newFsTestUser(t)
	files := map[string]string{"a.txt": "alpha", "b.txt": "bravo", "docs/c.txt": "charlie"}
	for name, content := range files {
		p := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(p, []byte(content), 0644); err != nil {
			t.Fatalf("write fixture: %v", err)
		}
	}
	vm := otto.New()
	minimalGateway().injectZipFileLibFunctions(&static.AgiLibInjectionPayload{VM: vm, User: u})
	return vm, dir
}

// archiveEntries lists the base names of the files in a zip, tar or tar.gz.
func archiveEntries(t *testing.T, file string) []string {
	t.Helper()
	var names []string
	if strings.HasSuffix(file, ".zip") {
		r, err := zip.OpenReader(file)
		if err != nil {
			t.Fatalf("open zip: %v", err)
		}
		defer r.Close()
		for _, f := range r.File {
			if !f.FileInfo().IsDir() {
				names = append(names, path.Base(f.Name))
			}
		}
	} else {
		f, err := os.Open(file)
		if err != nil {
			t.Fatalf("open archive: %v", err)
		}
		defer f.Close()
		var r io.Reader = f
		if strings.HasSuffix(file, ".tar.gz") {
			gz, err := gzip.NewReader(f)
			if err != nil {
				t.Fatalf("open gzip: %v", err)
			}
			defer gz.Close()
			r = gz
		}
		tr := tar.NewReader(r)
		for {
			h, err := tr.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatalf("read tar: %v", err)
			}
			if h.Typeflag != tar.TypeDir {
				names = append(names, path.Base(h.Name))
			}
		}
	}
	sort.Strings(names)
	return names
}

// A JS array of strings exports as []string, which the create functions used to
// reject; every source shape must now produce the archive.
func TestZiplibCreateFromSources(t *testing.T) {
	cases := []struct {
		name   string
		call   string // %s is replaced with the output path
		output string
		want   []string // nil means the call fails and writes nothing
	}{
		{"zip from array", `ziplib.createZipFile(["test:/a.txt", "test:/b.txt"], "%s")`, "out.zip", []string{"a.txt", "b.txt"}},
		{"zip from array of one", `ziplib.createZipFile(["test:/a.txt"], "%s")`, "out.zip", []string{"a.txt"}},
		{"zip from string", `ziplib.createZipFile("test:/a.txt", "%s")`, "out.zip", []string{"a.txt"}},
		{"zip from folder in array", `ziplib.createZipFile(["test:/docs"], "%s")`, "out.zip", []string{"c.txt"}},
		{"zip from number", `ziplib.createZipFile(42, "%s")`, "out.zip", nil},
		{"tar from array", `ziplib.createTarFile(["test:/a.txt", "test:/b.txt"], "%s")`, "out.tar", []string{"a.txt", "b.txt"}},
		{"tar from string", `ziplib.createTarFile("test:/a.txt", "%s")`, "out.tar", []string{"a.txt"}},
		{"tar from number", `ziplib.createTarFile(42, "%s")`, "out.tar", nil},
		{"tar.gz from array", `ziplib.createTarGzFile(["test:/a.txt", "test:/b.txt"], "%s")`, "out.tar.gz", []string{"a.txt", "b.txt"}},
		{"tar.gz from number", `ziplib.createTarGzFile(42, "%s")`, "out.tar.gz", nil},
		{"any zip from array", `ziplib.createAnyZipFile(["test:/a.txt", "test:/b.txt"], "%s", "zip")`, "out.zip", []string{"a.txt", "b.txt"}},
		{"any tar.gz from array", `ziplib.createAnyZipFile(["test:/a.txt", "test:/b.txt"], "%s", "tar.gz")`, "out.tar.gz", []string{"a.txt", "b.txt"}},
		{"any zip from number", `ziplib.createAnyZipFile(42, "%s", "zip")`, "out.zip", nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			vm, dir := newZipLibTestVM(t)
			val, err := vm.Run(strings.Replace(c.call, "%s", "test:/"+c.output, 1))
			if err != nil {
				t.Fatalf("%s: %v", c.call, err)
			}
			ok, _ := val.ToBoolean()
			outFile := filepath.Join(dir, c.output)
			if c.want == nil {
				if ok {
					t.Errorf("call returned true, want false")
				}
				if _, err := os.Stat(outFile); err == nil {
					t.Errorf("a failed call left %s behind", c.output)
				}
				return
			}
			if !ok {
				t.Fatalf("call returned false, want true")
			}
			if got := archiveEntries(t, outFile); !reflect.DeepEqual(got, c.want) {
				t.Errorf("archive holds %v, want %v", got, c.want)
			}
		})
	}
}

// writeTestZip writes a zip holding the given slash-separated entries, each
// containing its own name.
func writeTestZip(t *testing.T, file string, entries []string) {
	t.Helper()
	f, err := os.Create(file)
	if err != nil {
		t.Fatalf("create zip: %v", err)
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	for _, name := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("add %s: %v", name, err)
		}
		if _, err := w.Write([]byte(name)); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
}

func TestZiplibExtractPartialZip(t *testing.T) {
	cases := []struct {
		name  string
		paths string
		want  []string // files under the destination folder, slash separated
	}{
		{"array of one file", `["a.txt"]`, []string{"a.txt"}},
		{"array of files", `["a.txt", "b.txt"]`, []string{"a.txt", "b.txt"}},
		{"array with a folder", `["docs/"]`, []string{"docs/c.txt"}},
		{"single path string", `"b.txt"`, []string{"b.txt"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			vm, dir := newZipLibTestVM(t)
			writeTestZip(t, filepath.Join(dir, "in.zip"), []string{"a.txt", "b.txt", "docs/c.txt"})

			val, err := vm.Run(`ziplib.extractPartialZip("test:/in.zip", ` + c.paths + `, "test:/out")`)
			if err != nil {
				t.Fatalf("extractPartialZip: %v", err)
			}
			if ok, _ := val.ToBoolean(); !ok {
				t.Fatalf("extractPartialZip returned false")
			}

			var got []string
			outDir := filepath.Join(dir, "out")
			filepath.Walk(outDir, func(p string, info os.FileInfo, err error) error {
				if err == nil && !info.IsDir() {
					rel, _ := filepath.Rel(outDir, p)
					got = append(got, filepath.ToSlash(rel))
				}
				return nil
			})
			sort.Strings(got)
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("extracted %v, want %v", got, c.want)
			}
		})
	}
}

// Archives the create functions write can be read back by the extract
// functions. tar.gz used to panic both ways on an archiver built without its
// embedded Tar.
func TestZiplibCreateThenExtract(t *testing.T) {
	cases := []struct {
		name    string
		create  string
		extract string
	}{
		{"tar", `ziplib.createTarFile(["test:/a.txt", "test:/b.txt"], "test:/x.tar")`, `ziplib.extractTarFile("test:/x.tar", "test:/out")`},
		{"tar.gz", `ziplib.createTarGzFile(["test:/a.txt", "test:/b.txt"], "test:/x.tar.gz")`, `ziplib.extractTarGzFile("test:/x.tar.gz", "test:/out")`},
		{"any tar.gz", `ziplib.createAnyZipFile(["test:/a.txt", "test:/b.txt"], "test:/x.tgz", "tgz")`, `ziplib.extractAnyFile("test:/x.tgz", "test:/out")`},
		{"zip", `ziplib.createZipFile(["test:/a.txt", "test:/b.txt"], "test:/x.zip")`, `ziplib.extractZipFile("test:/x.zip", "test:/out")`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			vm, dir := newZipLibTestVM(t)
			for _, script := range []string{c.create, c.extract} {
				val, err := vm.Run(script)
				if err != nil {
					t.Fatalf("%s: %v", script, err)
				}
				if ok, _ := val.ToBoolean(); !ok {
					t.Fatalf("%s returned false", script)
				}
			}
			for name, want := range map[string]string{"a.txt": "alpha", "b.txt": "bravo"} {
				got, err := os.ReadFile(filepath.Join(dir, "out", name))
				if err != nil {
					t.Errorf("%s was not extracted: %v", name, err)
					continue
				}
				if string(got) != want {
					t.Errorf("%s holds %q, want %q", name, got, want)
				}
			}
		})
	}
}
