package git

/*
	ignore.go

	Appending rules to a repository's .gitignore.

	This lives in Go rather than in the calling script so the file handling —
	locating the repository root, preserving whatever the user already wrote,
	getting the trailing newline right and never writing a duplicate rule — is
	covered by tests.
*/

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// gitignoreName is the file rules are appended to, at the working tree root.
const gitignoreName = ".gitignore"

// ignoreHeader is written above the first block GitApp appends, so a user
// reading their .gitignore later can tell where the lines came from.
const ignoreHeader = "# Added by GitApp"

// AddIgnoreRules appends the given patterns to the repository's .gitignore,
// skipping any rule that is already there. The patterns actually written are
// returned so the caller can report precisely what changed.
func (m *Manager) AddIgnoreRules(realpath string, patterns []string) ([]string, error) {
	root, err := m.RepoRoot(realpath)
	if err != nil {
		return nil, err
	}

	wanted, err := normaliseIgnorePatterns(patterns)
	if err != nil {
		return nil, err
	}

	ignorePath := filepath.Join(root, gitignoreName)

	existing := ""
	if raw, rerr := os.ReadFile(ignorePath); rerr == nil {
		existing = string(raw)
	} else if !os.IsNotExist(rerr) {
		return nil, rerr
	}

	present := existingIgnoreRules(existing)

	added := []string{}
	for _, pattern := range wanted {
		if _, found := present[pattern]; found {
			continue
		}
		present[pattern] = struct{}{}
		added = append(added, pattern)
	}

	if len(added) == 0 {
		return added, nil
	}

	if err := os.WriteFile(ignorePath, []byte(appendIgnoreRules(existing, added)), 0664); err != nil {
		return nil, err
	}
	return added, nil
}

/*
appendIgnoreRules produces the new .gitignore content.

The existing content is never rewritten, only extended: the separating newlines
are added as needed so appending to a file with or without a trailing newline
both give a well formed result.
*/
func appendIgnoreRules(existing string, added []string) string {
	builder := strings.Builder{}
	builder.WriteString(existing)

	//The header, and the blank line that sets it apart, belong to the first
	//block only. Later calls join the block that is already there — otherwise
	//ignoring several folders one at a time leaves a blank line between every
	//pair of rules.
	startingBlock := !strings.Contains(existing, ignoreHeader)

	if existing != "" && !strings.HasSuffix(existing, "\n") {
		builder.WriteString("\n")
	}

	if startingBlock {
		if existing != "" && !strings.HasSuffix(existing, "\n\n") {
			builder.WriteString("\n")
		}
		builder.WriteString(ignoreHeader)
		builder.WriteString("\n")
	}

	for _, pattern := range added {
		builder.WriteString(pattern)
		builder.WriteString("\n")
	}

	return builder.String()
}

// existingIgnoreRules indexes the rules already in a .gitignore. Comments and
// blank lines are skipped so a rule that only appears inside a comment is not
// mistaken for an active one.
func existingIgnoreRules(content string) map[string]struct{} {
	rules := map[string]struct{}{}

	for _, line := range strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		rules[trimmed] = struct{}{}
	}
	return rules
}

// normaliseIgnorePatterns cleans the patterns coming from the browser and
// rejects anything that cannot be a gitignore rule. Duplicates within one call
// are collapsed so a single request never writes the same line twice.
func normaliseIgnorePatterns(patterns []string) ([]string, error) {
	results := []string{}
	seen := map[string]struct{}{}

	for _, pattern := range patterns {
		cleaned := strings.TrimSpace(pattern)
		cleaned = strings.ReplaceAll(cleaned, "\\", "/")
		cleaned = strings.TrimPrefix(cleaned, "./")

		if cleaned == "" {
			continue
		}
		//A rule spanning lines would silently become several rules
		if strings.ContainsAny(cleaned, "\n\r") {
			return nil, errors.New("ignore rule cannot contain a line break: " + pattern)
		}
		if strings.HasPrefix(cleaned, "#") {
			return nil, errors.New("ignore rule cannot start with '#': " + pattern)
		}

		if _, duplicate := seen[cleaned]; duplicate {
			continue
		}
		seen[cleaned] = struct{}{}
		results = append(results, cleaned)
	}

	if len(results) == 0 {
		return nil, errors.New("no usable ignore rule was given")
	}
	return results, nil
}
