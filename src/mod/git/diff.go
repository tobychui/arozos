package git

/*
	diff.go

	Text diffing for the GitApp diff viewer.

	go-git can produce patches between two commits but has no API for "working
	tree versus HEAD", which is exactly the diff the Changes tab shows. The line
	differ below is therefore implemented here: it trims the common prefix and
	suffix, runs an LCS over what is left and groups the result into hunks with
	three lines of context, matching unified-diff conventions.
*/

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
)

const (
	//maxDiffBytes is the largest file the differ will read on either side.
	maxDiffBytes = 2 * 1024 * 1024

	//maxLCSRegion bounds the quadratic part of the algorithm. Regions larger
	//than this are emitted as a plain delete-then-insert block, which keeps a
	//huge rewrite from pinning memory.
	maxLCSRegion = 2000

	//diffContextLines is the number of unchanged lines kept around each change.
	diffContextLines = 3
)

// Diff returns the diff of one repo-relative path between HEAD and the current
// working tree — the change the user is about to commit.
func (m *Manager) Diff(realpath string, file string) (*FileDiff, error) {
	cleaned, err := cleanRepoPath(file)
	if err != nil {
		return nil, err
	}

	repo, tree, err := m.worktree(realpath)
	if err != nil {
		return nil, err
	}

	//Old side: the blob recorded in HEAD, absent for a newly added file
	oldContent, oldExists, err := headBlobContent(repo, cleaned)
	if err != nil {
		return nil, err
	}

	//New side: what is on disk right now, absent for a deleted file
	newContent, newExists, err := worktreeContent(tree.Filesystem.Root(), cleaned)
	if err != nil {
		return nil, err
	}

	if !oldExists && !newExists {
		return nil, errors.New("file not found in HEAD or working tree: " + cleaned)
	}

	return buildFileDiff(cleaned, oldContent, newContent, oldExists, newExists), nil
}

// DiffCommit returns the diff of one path introduced by a commit, comparing it
// against the commit's first parent. Used by the History tab.
func (m *Manager) DiffCommit(realpath string, hash string, file string) (*FileDiff, error) {
	cleaned, err := cleanRepoPath(file)
	if err != nil {
		return nil, err
	}

	repo, err := m.open(realpath)
	if err != nil {
		return nil, err
	}

	commit, err := repo.CommitObject(plumbing.NewHash(hash))
	if err != nil {
		return nil, err
	}

	newContent, newExists := treeFileContent(commit, cleaned)

	oldContent, oldExists := []byte{}, false
	if parent, perr := commit.Parent(0); perr == nil {
		oldContent, oldExists = treeFileContent(parent, cleaned)
	}

	if !oldExists && !newExists {
		return nil, errors.New("file not found in commit: " + cleaned)
	}

	return buildFileDiff(cleaned, oldContent, newContent, oldExists, newExists), nil
}

// CommitFiles lists the paths a commit touched, for the History tab file list.
func (m *Manager) CommitFiles(realpath string, hash string) ([]FileChange, error) {
	repo, err := m.open(realpath)
	if err != nil {
		return nil, err
	}

	commit, err := repo.CommitObject(plumbing.NewHash(hash))
	if err != nil {
		return nil, err
	}

	commitTree, err := commit.Tree()
	if err != nil {
		return nil, err
	}

	var parentTree *object.Tree
	if parent, perr := commit.Parent(0); perr == nil {
		parentTree, _ = parent.Tree()
	}

	changes, err := object.DiffTree(parentTree, commitTree)
	if err != nil {
		return nil, err
	}

	results := []FileChange{}
	for _, change := range changes {
		action, aerr := change.Action()
		if aerr != nil {
			continue
		}

		path := change.To.Name
		status := "modified"
		switch action.String() {
		case "Insert":
			status = "added"
		case "Delete":
			status = "deleted"
			path = change.From.Name
		}

		results = append(results, FileChange{
			Path:     filepath.ToSlash(path),
			Status:   status,
			Staging:  status,
			Worktree: "unmodified",
			Staged:   true,
			Size:     -1,
			Preview:  PreviewKind(path),
		})
	}

	return results, nil
}

// headBlobContent reads a path out of the HEAD commit tree.
func headBlobContent(repo *gogit.Repository, file string) ([]byte, bool, error) {
	head, err := repo.Head()
	if err != nil {
		if errors.Is(err, plumbing.ErrReferenceNotFound) {
			//Unborn branch: everything counts as newly added
			return []byte{}, false, nil
		}
		return nil, false, err
	}

	commit, err := repo.CommitObject(head.Hash())
	if err != nil {
		return nil, false, err
	}

	content, exists := treeFileContent(commit, file)
	return content, exists, nil
}

// treeFileContent reads a path from a commit's tree, reporting whether it was
// present at all.
func treeFileContent(commit *object.Commit, file string) ([]byte, bool) {
	if commit == nil {
		return []byte{}, false
	}

	treeFile, err := commit.File(file)
	if err != nil {
		return []byte{}, false
	}

	if treeFile.Size > maxDiffBytes {
		return nil, true
	}

	reader, err := treeFile.Reader()
	if err != nil {
		return []byte{}, false
	}
	defer reader.Close()

	content, err := io.ReadAll(reader)
	if err != nil {
		return []byte{}, false
	}
	return content, true
}

// worktreeContent reads a path from the working tree.
func worktreeContent(repoRoot string, file string) ([]byte, bool, error) {
	fullPath := filepath.Join(repoRoot, filepath.FromSlash(file))

	info, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []byte{}, false, nil
		}
		return nil, false, err
	}
	if info.IsDir() {
		return []byte{}, false, nil
	}
	if info.Size() > maxDiffBytes {
		//Present but deliberately not read; buildFileDiff flags it as too large
		return nil, true, nil
	}

	content, err := os.ReadFile(fullPath)
	if err != nil {
		return nil, false, err
	}
	return content, true, nil
}

// buildFileDiff turns two file contents into the rendered diff structure.
func buildFileDiff(path string, oldContent []byte, newContent []byte, oldExists bool, newExists bool) *FileDiff {
	diff := &FileDiff{
		Path:      path,
		IsNew:     !oldExists,
		IsDeleted: !newExists,
		Hunks:     []DiffHunk{},
	}

	//A nil content with the side marked present means the file exceeded the
	//read limit
	if (oldContent == nil && oldExists) || (newContent == nil && newExists) {
		diff.TooLarge = true
		return diff
	}

	if isBinaryContent(oldContent) || isBinaryContent(newContent) {
		diff.Binary = true
		return diff
	}

	oldLines := splitLines(string(oldContent))
	newLines := splitLines(string(newContent))

	operations := diffLines(oldLines, newLines)
	diff.Hunks = buildHunks(operations)

	for _, hunk := range diff.Hunks {
		for _, line := range hunk.Lines {
			switch line.Type {
			case "add":
				diff.Additions++
			case "del":
				diff.Deletions++
			}
		}
	}

	return diff
}

// diffOp is one line-level edit produced by the differ.
type diffOp struct {
	kind string //"context", "add" or "del"
	text string
}

// diffLines produces the edit script turning oldLines into newLines.
func diffLines(oldLines []string, newLines []string) []diffOp {
	operations := []diffOp{}

	//Trim the common prefix — most edits touch a small part of a file, and this
	//keeps the quadratic section tiny.
	prefix := 0
	for prefix < len(oldLines) && prefix < len(newLines) && oldLines[prefix] == newLines[prefix] {
		operations = append(operations, diffOp{kind: "context", text: oldLines[prefix]})
		prefix++
	}

	//Trim the common suffix
	suffix := 0
	for suffix < len(oldLines)-prefix &&
		suffix < len(newLines)-prefix &&
		oldLines[len(oldLines)-1-suffix] == newLines[len(newLines)-1-suffix] {
		suffix++
	}

	oldMiddle := oldLines[prefix : len(oldLines)-suffix]
	newMiddle := newLines[prefix : len(newLines)-suffix]

	operations = append(operations, diffMiddle(oldMiddle, newMiddle)...)

	for i := len(oldLines) - suffix; i < len(oldLines); i++ {
		operations = append(operations, diffOp{kind: "context", text: oldLines[i]})
	}

	return operations
}

// diffMiddle runs the LCS over the changed region, falling back to a plain
// replace when the region is too large to diff cheaply.
func diffMiddle(oldLines []string, newLines []string) []diffOp {
	operations := []diffOp{}

	if len(oldLines) == 0 && len(newLines) == 0 {
		return operations
	}

	if len(oldLines) > maxLCSRegion || len(newLines) > maxLCSRegion {
		for _, line := range oldLines {
			operations = append(operations, diffOp{kind: "del", text: line})
		}
		for _, line := range newLines {
			operations = append(operations, diffOp{kind: "add", text: line})
		}
		return operations
	}

	oldCount, newCount := len(oldLines), len(newLines)

	//lcs[i][j] is the length of the longest common subsequence of
	//oldLines[i:] and newLines[j:]
	lcs := make([][]int32, oldCount+1)
	for i := range lcs {
		lcs[i] = make([]int32, newCount+1)
	}
	for i := oldCount - 1; i >= 0; i-- {
		for j := newCount - 1; j >= 0; j-- {
			if oldLines[i] == newLines[j] {
				lcs[i][j] = lcs[i+1][j+1] + 1
			} else if lcs[i+1][j] >= lcs[i][j+1] {
				lcs[i][j] = lcs[i+1][j]
			} else {
				lcs[i][j] = lcs[i][j+1]
			}
		}
	}

	i, j := 0, 0
	for i < oldCount && j < newCount {
		switch {
		case oldLines[i] == newLines[j]:
			operations = append(operations, diffOp{kind: "context", text: oldLines[i]})
			i++
			j++
		case lcs[i+1][j] >= lcs[i][j+1]:
			operations = append(operations, diffOp{kind: "del", text: oldLines[i]})
			i++
		default:
			operations = append(operations, diffOp{kind: "add", text: newLines[j]})
			j++
		}
	}
	for ; i < oldCount; i++ {
		operations = append(operations, diffOp{kind: "del", text: oldLines[i]})
	}
	for ; j < newCount; j++ {
		operations = append(operations, diffOp{kind: "add", text: newLines[j]})
	}

	return operations
}

// buildHunks groups the edit script into unified-diff hunks, keeping
// diffContextLines unchanged lines on either side of every change.
func buildHunks(operations []diffOp) []DiffHunk {
	hunks := []DiffHunk{}
	if len(operations) == 0 {
		return hunks
	}

	//Mark which operations must appear: every change plus its context window
	keep := make([]bool, len(operations))
	hasChange := false
	for index, operation := range operations {
		if operation.kind == "context" {
			continue
		}
		hasChange = true
		start := index - diffContextLines
		if start < 0 {
			start = 0
		}
		end := index + diffContextLines
		if end > len(operations)-1 {
			end = len(operations) - 1
		}
		for k := start; k <= end; k++ {
			keep[k] = true
		}
	}

	if !hasChange {
		return hunks
	}

	//Walk the script assigning line numbers, cutting a new hunk whenever the
	//kept region breaks
	oldLineNumber, newLineNumber := 1, 1
	var current *DiffHunk

	flush := func() {
		if current != nil && len(current.Lines) > 0 {
			current.Header = "@@ -" + strconv.Itoa(current.OldStart) + "," + strconv.Itoa(current.OldLines) +
				" +" + strconv.Itoa(current.NewStart) + "," + strconv.Itoa(current.NewLines) + " @@"
			hunks = append(hunks, *current)
		}
		current = nil
	}

	for index, operation := range operations {
		if !keep[index] {
			flush()
			switch operation.kind {
			case "context":
				oldLineNumber++
				newLineNumber++
			case "del":
				oldLineNumber++
			case "add":
				newLineNumber++
			}
			continue
		}

		if current == nil {
			current = &DiffHunk{
				OldStart: oldLineNumber,
				NewStart: newLineNumber,
				Lines:    []DiffLine{},
			}
		}

		line := DiffLine{Type: operation.kind, Content: operation.text}
		switch operation.kind {
		case "context":
			line.OldLine = oldLineNumber
			line.NewLine = newLineNumber
			oldLineNumber++
			newLineNumber++
			current.OldLines++
			current.NewLines++
		case "del":
			line.OldLine = oldLineNumber
			oldLineNumber++
			current.OldLines++
		case "add":
			line.NewLine = newLineNumber
			newLineNumber++
			current.NewLines++
		}
		current.Lines = append(current.Lines, line)
	}

	flush()
	return hunks
}

// splitLines splits content into lines, dropping the trailing empty element a
// final newline produces and normalising CRLF so a Windows checkout of a Unix
// file does not report every line as changed.
func splitLines(content string) []string {
	if content == "" {
		return []string{}
	}

	content = strings.ReplaceAll(content, "\r\n", "\n")
	lines := strings.Split(content, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

// isBinaryContent applies git's own NUL-byte heuristic to in-memory content.
func isBinaryContent(content []byte) bool {
	limit := len(content)
	if limit > 8000 {
		limit = 8000
	}
	for i := 0; i < limit; i++ {
		if content[i] == 0 {
			return true
		}
	}
	return false
}
