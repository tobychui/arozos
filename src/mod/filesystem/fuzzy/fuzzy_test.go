package fuzzy

import (
	"testing"
)

func TestNewFuzzyMatcher_BasicMatch(t *testing.T) {
	m := NewFuzzyMatcher("hello", false)
	if m == nil {
		t.Fatal("NewFuzzyMatcher returned nil")
	}
	if !m.Match("hello world.txt") {
		t.Error("expected match for 'hello world.txt'")
	}
	if m.Match("goodbye world.txt") {
		t.Error("expected no match for 'goodbye world.txt'")
	}
}

func TestNewFuzzyMatcher_CaseInsensitive(t *testing.T) {
	m := NewFuzzyMatcher("Hello", false)
	if !m.Match("HELLO world.txt") {
		t.Error("expected case-insensitive match for 'HELLO world.txt'")
	}
	if !m.Match("hello world.txt") {
		t.Error("expected case-insensitive match for 'hello world.txt'")
	}
}

func TestNewFuzzyMatcher_CaseSensitive(t *testing.T) {
	m := NewFuzzyMatcher("Hello", true)
	if !m.Match("Hello world.txt") {
		t.Error("expected match for 'Hello world.txt' with case-sensitive")
	}
	if m.Match("hello world.txt") {
		t.Error("expected no match for 'hello world.txt' with case-sensitive 'Hello'")
	}
	if m.Match("HELLO world.txt") {
		t.Error("expected no match for 'HELLO world.txt' with case-sensitive 'Hello'")
	}
}

func TestNewFuzzyMatcher_MultipleKeywords(t *testing.T) {
	// All keywords must match (AND logic)
	m := NewFuzzyMatcher("world hello", false)
	if !m.Match("Hello World.txt") {
		t.Error("expected match for 'Hello World.txt' with 'world hello'")
	}
	if m.Match("hello only.txt") {
		t.Error("expected no match for 'hello only.txt' - 'world' not present")
	}
	if m.Match("world only.txt") {
		t.Error("expected no match for 'world only.txt' - 'hello' not present")
	}
}

func TestNewFuzzyMatcher_ExcludeKeyword(t *testing.T) {
	m := NewFuzzyMatcher("hello -world", false)
	if !m.Match("hello everyone.txt") {
		t.Error("expected match for 'hello everyone.txt'")
	}
	if m.Match("hello world.txt") {
		t.Error("expected no match for 'hello world.txt' - 'world' excluded")
	}
}

func TestNewFuzzyMatcher_ExcludedKeywordOnly(t *testing.T) {
	m := NewFuzzyMatcher("-bad", false)
	if !m.Match("good file.txt") {
		t.Error("expected match for 'good file.txt' when only exclusion is 'bad'")
	}
	if m.Match("badfile.txt") {
		t.Error("expected no match for 'badfile.txt' - 'bad' excluded")
	}
}

func TestNewFuzzyMatcher_QuotedPhrase(t *testing.T) {
	// Quoted phrases (space inside quotes) must match as a whole
	m := NewFuzzyMatcher("\"hello world\"", false)
	if !m.Match("hello world.txt") {
		t.Error("expected match for 'hello world.txt' with phrase \"hello world\"")
	}
	if m.Match("hello there world.txt") {
		t.Error("expected no match for 'hello there world.txt' - phrase 'hello world' not contiguous")
	}
}

func TestNewFuzzyMatcher_QuotedSingleWord(t *testing.T) {
	// A quoted single word (start and end quote on same chunk)
	m := NewFuzzyMatcher("\"hello\"", false)
	if !m.Match("hello world.txt") {
		t.Error("expected match for 'hello world.txt' with quoted single word")
	}
	if m.Match("world.txt") {
		t.Error("expected no match for 'world.txt'")
	}
}

func TestNewFuzzyMatcher_ExcludeQuotedPhrase(t *testing.T) {
	m := NewFuzzyMatcher("hello -\"not this\"", false)
	if !m.Match("Hello World.txt") {
		t.Error("expected match for 'Hello World.txt'")
	}
	if m.Match("Hello World not this.txt") {
		t.Error("expected no match for 'Hello World not this.txt' - excluded phrase present")
	}
}

func TestNewFuzzyMatcher_EmptyInput(t *testing.T) {
	m := NewFuzzyMatcher("", false)
	// With no keywords and no exclusions, everything should match
	if !m.Match("anything.txt") {
		t.Error("expected empty matcher to match any string")
	}
	if !m.Match("") {
		t.Error("expected empty matcher to match empty string")
	}
}

func TestNewFuzzyMatcher_NoMatch(t *testing.T) {
	m := NewFuzzyMatcher("xyz", false)
	if m.Match("hello world.txt") {
		t.Error("expected no match for 'hello world.txt' with keyword 'xyz'")
	}
}

func TestNewFuzzyMatcher_DescriptionScenario(t *testing.T) {
	// Scenario from the package documentation:
	// Files: "Hello World.txt" and "Hello World not this.txt"
	// Input: World Hello -"not this" .txt
	// Expected: "Hello World.txt" matches, "Hello World not this.txt" does not
	m := NewFuzzyMatcher("World Hello -\"not this\" .txt", false)

	if !m.Match("Hello World.txt") {
		t.Error("expected 'Hello World.txt' to match")
	}
	if m.Match("Hello World not this.txt") {
		t.Error("expected 'Hello World not this.txt' NOT to match")
	}
}

func TestNewFuzzyMatcher_MultipleExcludes(t *testing.T) {
	m := NewFuzzyMatcher("hello -bad -ugly", false)
	if !m.Match("hello beautiful.txt") {
		t.Error("expected match for 'hello beautiful.txt'")
	}
	if m.Match("hello bad.txt") {
		t.Error("expected no match for 'hello bad.txt'")
	}
	if m.Match("hello ugly.txt") {
		t.Error("expected no match for 'hello ugly.txt'")
	}
}

func TestMatch_EmptyFilename(t *testing.T) {
	m := NewFuzzyMatcher("hello", false)
	if m.Match("") {
		t.Error("expected no match for empty filename with keyword 'hello'")
	}
}

func TestNewFuzzyMatcher_FileExtensionMatch(t *testing.T) {
	m := NewFuzzyMatcher(".txt", false)
	if !m.Match("document.txt") {
		t.Error("expected match for 'document.txt'")
	}
	if m.Match("document.pdf") {
		t.Error("expected no match for 'document.pdf'")
	}
}

func TestBuildFuzzyChunks_IncludeAndExclude(t *testing.T) {
	// Test the internal buildFuzzyChunks directly
	includeList, excludeList := buildFuzzyChunks("hello -world", false)
	if len(includeList) != 1 || includeList[0] != "hello" {
		t.Errorf("includeList = %v, want [hello]", includeList)
	}
	if len(excludeList) != 1 || excludeList[0] != "world" {
		t.Errorf("excludeList = %v, want [world]", excludeList)
	}
}

func TestBuildFuzzyChunks_CaseSensitive(t *testing.T) {
	includeList, _ := buildFuzzyChunks("Hello World", true)
	if len(includeList) != 2 {
		t.Fatalf("expected 2 include keywords, got %d", len(includeList))
	}
	if includeList[0] != "Hello" {
		t.Errorf("includeList[0] = %q, want %q", includeList[0], "Hello")
	}
	if includeList[1] != "World" {
		t.Errorf("includeList[1] = %q, want %q", includeList[1], "World")
	}
}

func TestBuildFuzzyChunks_CaseInsensitive(t *testing.T) {
	includeList, _ := buildFuzzyChunks("Hello World", false)
	if len(includeList) != 2 {
		t.Fatalf("expected 2 include keywords, got %d", len(includeList))
	}
	if includeList[0] != "hello" {
		t.Errorf("includeList[0] = %q, want %q", includeList[0], "hello")
	}
	if includeList[1] != "world" {
		t.Errorf("includeList[1] = %q, want %q", includeList[1], "world")
	}
}

func TestBuildFuzzyChunks_MultiWordQuotedExclude(t *testing.T) {
	_, excludeList := buildFuzzyChunks("-\"not this\"", false)
	if len(excludeList) != 1 || excludeList[0] != "not this" {
		t.Errorf("excludeList = %v, want [not this]", excludeList)
	}
}

func TestBuildFuzzyChunks_MultiWordQuotedInclude(t *testing.T) {
	includeList, _ := buildFuzzyChunks("\"hello world\"", false)
	if len(includeList) != 1 || includeList[0] != "hello world" {
		t.Errorf("includeList = %v, want [hello world]", includeList)
	}
}
