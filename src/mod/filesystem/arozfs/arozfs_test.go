package arozfs

import (
	"strings"
	"testing"
)

// --- NewRedirectionError ---

func TestNewRedirectionError_Format(t *testing.T) {
	err := NewRedirectionError("/home/user/docs")
	if err == nil {
		t.Fatal("expected non-nil error")
	}
	want := "Redirect:/home/user/docs"
	if err.Error() != want {
		t.Errorf("got %q, want %q", err.Error(), want)
	}
}

func TestNewRedirectionError_EmptyPath(t *testing.T) {
	err := NewRedirectionError("")
	if err == nil {
		t.Fatal("expected non-nil error")
	}
	if err.Error() != "Redirect:" {
		t.Errorf("unexpected error message: %q", err.Error())
	}
}

func TestNewRedirectionError_PrefixedPath(t *testing.T) {
	err := NewRedirectionError("S1:/music")
	if err == nil {
		t.Fatal("expected non-nil error")
	}
	if !strings.HasPrefix(err.Error(), "Redirect:") {
		t.Errorf("error should start with 'Redirect:': got %q", err.Error())
	}
}

// --- Error variables ---

func TestErrorVariables_NotNil(t *testing.T) {
	vars := []error{
		ErrRedirectParent,
		ErrRedirectCurrentRoot,
		ErrRedirectUserRoot,
		ErrVpathResolveFailed,
		ErrRpathResolveFailed,
		ErrFSHNotFOund,
		ErrOperationNotSupported,
		ErrNullOperation,
	}
	for _, v := range vars {
		if v == nil {
			t.Errorf("error variable should not be nil")
		}
	}
}

func TestErrorVariables_Messages(t *testing.T) {
	cases := []struct {
		err  error
		want string
	}{
		{ErrRedirectParent, "Redirect:parent"},
		{ErrRedirectCurrentRoot, "Redirect:root"},
		{ErrRedirectUserRoot, "Redirect:userroot"},
		{ErrVpathResolveFailed, "FS_VPATH_RESOLVE_FAILED"},
		{ErrRpathResolveFailed, "FS_RPATH_RESOLVE_FAILED"},
		{ErrFSHNotFOund, "FS_FILESYSTEM_HANDLER_NOT_FOUND"},
		{ErrOperationNotSupported, "FS_OPR_NOT_SUPPORTED"},
		{ErrNullOperation, "FS_NULL_OPR"},
	}
	for _, c := range cases {
		if c.err.Error() != c.want {
			t.Errorf("got %q, want %q", c.err.Error(), c.want)
		}
	}
}

// --- IsNetworkDrive ---

func TestIsNetworkDrive_TrueTypes(t *testing.T) {
	for _, fstype := range []string{"webdav", "ftp", "smb", "sftp"} {
		if !IsNetworkDrive(fstype) {
			t.Errorf("expected IsNetworkDrive(%q) = true", fstype)
		}
	}
}

func TestIsNetworkDrive_FalseTypes(t *testing.T) {
	for _, fstype := range []string{"ext4", "ntfs", "fat", "vfat", "", "local", "nfs"} {
		if IsNetworkDrive(fstype) {
			t.Errorf("expected IsNetworkDrive(%q) = false", fstype)
		}
	}
}

// --- GetSupportedFileSystemTypes ---

func TestGetSupportedFileSystemTypes_NotEmpty(t *testing.T) {
	types := GetSupportedFileSystemTypes()
	if len(types) == 0 {
		t.Fatal("expected at least one supported filesystem type")
	}
}

func TestGetSupportedFileSystemTypes_ContainsExpected(t *testing.T) {
	types := GetSupportedFileSystemTypes()
	expected := []string{"ext4", "ntfs", "webdav", "ftp", "smb", "sftp"}
	typeSet := make(map[string]bool, len(types))
	for _, t := range types {
		typeSet[t] = true
	}
	for _, e := range expected {
		if !typeSet[e] {
			t.Errorf("expected %q in supported types", e)
		}
	}
}

// --- GenericPathFilter ---

func TestGenericPathFilter_DotPrefix(t *testing.T) {
	// filepath.Clean("./foo") => "foo" on unix, then GenericPathFilter returns "/foo" trimmed to "/" not "foo"
	// Actually: ToSlash(filepath.Clean("./foo")) = "foo", rawpath "foo", no "./" prefix, no ".", not ""
	result := GenericPathFilter("foo")
	if result != "foo" {
		t.Errorf("got %q, want %q", result, "foo")
	}
}

func TestGenericPathFilter_SlashPath(t *testing.T) {
	result := GenericPathFilter("/home/user/docs")
	if result != "/home/user/docs" {
		t.Errorf("got %q, want %q", result, "/home/user/docs")
	}
}

func TestGenericPathFilter_EmptyString(t *testing.T) {
	result := GenericPathFilter("")
	if result != "/" {
		t.Errorf("got %q, want %q", result, "/")
	}
}

func TestGenericPathFilter_DotOnly(t *testing.T) {
	result := GenericPathFilter(".")
	if result != "/" {
		t.Errorf("got %q, want %q", result, "/")
	}
}

func TestGenericPathFilter_BackslashConverted(t *testing.T) {
	result := GenericPathFilter("C:\\Users\\test")
	// filepath.Clean + ToSlash removes redundant separators
	if strings.Contains(result, "\\") {
		t.Errorf("expected backslashes to be removed, got %q", result)
	}
}

func TestGenericPathFilter_NestedPath(t *testing.T) {
	result := GenericPathFilter("/a/b/c")
	if result != "/a/b/c" {
		t.Errorf("got %q, want %q", result, "/a/b/c")
	}
}

// --- FilterIllegalCharInFilename ---

func TestFilterIllegalCharInFilename_NoIllegalChars(t *testing.T) {
	result := FilterIllegalCharInFilename("normal_file-name.txt", "_")
	if result != "normal_file-name.txt" {
		t.Errorf("got %q, want %q", result, "normal_file-name.txt")
	}
}

func TestFilterIllegalCharInFilename_Backslash(t *testing.T) {
	result := FilterIllegalCharInFilename(`file\name`, "-")
	if strings.Contains(result, `\`) {
		t.Errorf("expected backslash to be replaced, got %q", result)
	}
}

func TestFilterIllegalCharInFilename_Brackets(t *testing.T) {
	result := FilterIllegalCharInFilename("file[1].txt", "_")
	if strings.Contains(result, "[") || strings.Contains(result, "]") {
		t.Errorf("expected brackets to be replaced, got %q", result)
	}
}

func TestFilterIllegalCharInFilename_SpecialChars(t *testing.T) {
	illegalChars := []string{"$", "?", "#", "<", ">", "+", "%", "!", `"`, "'", "|", "{", "}", ":", "@"}
	for _, ch := range illegalChars {
		input := "file" + ch + "name.txt"
		result := FilterIllegalCharInFilename(input, "_")
		if strings.Contains(result, ch) {
			t.Errorf("expected %q to be replaced in %q, got %q", ch, input, result)
		}
	}
}

func TestFilterIllegalCharInFilename_EmptyReplacement(t *testing.T) {
	result := FilterIllegalCharInFilename("file?name.txt", "")
	if strings.Contains(result, "?") {
		t.Errorf("expected '?' to be removed, got %q", result)
	}
	if result != "filename.txt" {
		t.Errorf("got %q, want %q", result, "filename.txt")
	}
}

func TestFilterIllegalCharInFilename_MultipleReplacements(t *testing.T) {
	result := FilterIllegalCharInFilename("file?#<>.txt", "-")
	// all illegal chars replaced with '-'
	if strings.Contains(result, "?") || strings.Contains(result, "#") ||
		strings.Contains(result, "<") || strings.Contains(result, ">") {
		t.Errorf("expected illegal chars to be replaced, got %q", result)
	}
}

// --- ToSlash ---

func TestToSlash_NoChange(t *testing.T) {
	result := ToSlash("/home/user/file.txt")
	if result != "/home/user/file.txt" {
		t.Errorf("got %q, want %q", result, "/home/user/file.txt")
	}
}

func TestToSlash_BackslashReplaced(t *testing.T) {
	result := ToSlash(`C:\Users\test\file.txt`)
	want := "C:/Users/test/file.txt"
	if result != want {
		t.Errorf("got %q, want %q", result, want)
	}
}

func TestToSlash_MixedSlashes(t *testing.T) {
	result := ToSlash(`a\b/c\d`)
	want := "a/b/c/d"
	if result != want {
		t.Errorf("got %q, want %q", result, want)
	}
}

func TestToSlash_Empty(t *testing.T) {
	result := ToSlash("")
	if result != "" {
		t.Errorf("got %q, want %q", result, "")
	}
}

// --- Base ---

func TestBase_SimpleFilename(t *testing.T) {
	result := Base("file.txt")
	if result != "file.txt" {
		t.Errorf("got %q, want %q", result, "file.txt")
	}
}

func TestBase_PathWithSlash(t *testing.T) {
	result := Base("/home/user/file.txt")
	if result != "file.txt" {
		t.Errorf("got %q, want %q", result, "file.txt")
	}
}

func TestBase_TrailingSlash(t *testing.T) {
	result := Base("/home/user/")
	if result != "user" {
		t.Errorf("got %q, want %q", result, "user")
	}
}

func TestBase_RootSlash(t *testing.T) {
	result := Base("/")
	if result != "/" {
		t.Errorf("got %q, want %q", result, "/")
	}
}

func TestBase_EmptyString(t *testing.T) {
	result := Base("")
	if result != "." {
		t.Errorf("got %q, want %q", result, ".")
	}
}

func TestBase_Backslash(t *testing.T) {
	result := Base(`C:\Users\test\file.txt`)
	if result != "file.txt" {
		t.Errorf("got %q, want %q", result, "file.txt")
	}
}

func TestBase_MultipleTrailingSlashes(t *testing.T) {
	result := Base("/home/user///")
	if result != "user" {
		t.Errorf("got %q, want %q", result, "user")
	}
}

// --- GenericVirtualPathToRealPathTranslator ---

func TestGenericVirtualPathToRealPathTranslator_UserHierarchy(t *testing.T) {
	result, err := GenericVirtualPathToRealPathTranslator("S1", "user", "/documents", "alice")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(result, "alice") {
		t.Errorf("expected username in path, got %q", result)
	}
}

func TestGenericVirtualPathToRealPathTranslator_PublicHierarchy(t *testing.T) {
	result, err := GenericVirtualPathToRealPathTranslator("S1", "public", "/shared", "alice")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(result, "shared") {
		t.Errorf("expected 'shared' in path, got %q", result)
	}
}

func TestGenericVirtualPathToRealPathTranslator_UnsupportedHierarchy(t *testing.T) {
	_, err := GenericVirtualPathToRealPathTranslator("S1", "unknown", "/docs", "alice")
	if err == nil {
		t.Fatal("expected error for unsupported hierarchy")
	}
}

func TestGenericVirtualPathToRealPathTranslator_FullVpath(t *testing.T) {
	result, err := GenericVirtualPathToRealPathTranslator("S1", "public", "S1:/music", "alice")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if strings.Contains(result, "S1:") {
		t.Errorf("full vpath prefix should be stripped, got %q", result)
	}
}

// --- GenericRealPathToVirtualPathTranslator ---

func TestGenericRealPathToVirtualPathTranslator_UserHierarchy(t *testing.T) {
	result, err := GenericRealPathToVirtualPathTranslator("S1", "user", "/users/alice/docs", "alice")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(result, "S1:") {
		t.Errorf("expected result to start with UUID prefix, got %q", result)
	}
}

func TestGenericRealPathToVirtualPathTranslator_PublicHierarchy(t *testing.T) {
	result, err := GenericRealPathToVirtualPathTranslator("S1", "public", "/shared/music", "alice")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(result, "S1:") {
		t.Errorf("expected result to start with UUID prefix, got %q", result)
	}
}
