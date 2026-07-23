package git

/*
	types.go

	Wire types shared between the git manager, the AGI gitlib bindings and the
	GitApp front-end. Everything here is plain JSON-tagged data so a value can be
	handed straight to json.Marshal and injected into an Otto VM.
*/

// FileChange is a single entry of the "Changes" list, mirroring one row of the
// GitHub Desktop changes sidebar.
type FileChange struct {
	Path     string `json:"path"`               //Repo-relative path, always slash separated
	OldPath  string `json:"oldPath,omitempty"`  //Previous path for renames
	Staging  string `json:"staging"`            //Index state: unmodified/added/modified/deleted/renamed/copied/untracked/conflicted
	Worktree string `json:"worktree"`           //Working tree state, same vocabulary as Staging
	Status   string `json:"status"`             //Single summarised state used by the UI
	Staged   bool   `json:"staged"`             //True when the index differs from HEAD for this path
	Binary   bool   `json:"binary"`             //True when the file looks binary (no text diff available)
	Size     int64  `json:"size"`               //Working tree size in bytes, -1 when the file is gone
	Conflict bool   `json:"conflict,omitempty"` //True on an unresolved merge conflict
	Preview  string `json:"preview,omitempty"`  //Renderable kind: image/pdf/video/audio, empty when there is none
}

// RepoStatus is the full snapshot the GitApp polls after every operation.
type RepoStatus struct {
	Path       string       `json:"path"`            //Virtual path of the repository root (filled in by the AGI layer)
	Branch     string       `json:"branch"`          //Current branch name, empty when HEAD is detached
	Detached   bool         `json:"detached"`        //True when HEAD does not point at a branch
	Head       *CommitInfo  `json:"head"`            //Commit HEAD resolves to, nil on an unborn branch
	Upstream   string       `json:"upstream"`        //Tracking ref, e.g. "origin/master", empty when unset
	Ahead      int          `json:"ahead"`           //Commits the local branch has that upstream does not
	Behind     int          `json:"behind"`          //Commits upstream has that the local branch does not
	Clean      bool         `json:"clean"`           //True when there is nothing to commit
	Changes    []FileChange `json:"changes"`         //Changed files, sorted by path
	Remotes    []RemoteInfo `json:"remotes"`         //Configured remotes
	Conflicted bool         `json:"conflicted"`      //True when at least one path is unmerged
	Error      string       `json:"error,omitempty"` //Non-fatal note, e.g. upstream missing
}

// CommitInfo describes a single commit for the History tab.
type CommitInfo struct {
	Hash        string   `json:"hash"`
	ShortHash   string   `json:"shortHash"`
	Message     string   `json:"message"` //Full commit message
	Subject     string   `json:"subject"` //First line of the message
	AuthorName  string   `json:"authorName"`
	AuthorEmail string   `json:"authorEmail"`
	Timestamp   int64    `json:"timestamp"` //Author time, unix seconds
	Parents     []string `json:"parents"`
}

// BranchInfo is one entry of the branch switcher dropdown.
type BranchInfo struct {
	Name      string `json:"name"`
	FullRef   string `json:"fullRef"`
	Hash      string `json:"hash"`
	IsRemote  bool   `json:"isRemote"`
	IsCurrent bool   `json:"isCurrent"`
}

// RemoteInfo is a configured git remote.
type RemoteInfo struct {
	Name string   `json:"name"`
	URLs []string `json:"urls"`
}

// DiffLine is one rendered row of the diff viewer.
type DiffLine struct {
	Type    string `json:"type"`    //"context", "add" or "del"
	OldLine int    `json:"oldLine"` //1-based line number in the old file, 0 when absent
	NewLine int    `json:"newLine"` //1-based line number in the new file, 0 when absent
	Content string `json:"content"`
}

// DiffHunk groups consecutive DiffLines the way `@@` headers do.
type DiffHunk struct {
	OldStart int        `json:"oldStart"`
	OldLines int        `json:"oldLines"`
	NewStart int        `json:"newStart"`
	NewLines int        `json:"newLines"`
	Header   string     `json:"header"`
	Lines    []DiffLine `json:"lines"`
}

// FileDiff is the diff of one path between two states.
type FileDiff struct {
	Path      string     `json:"path"`
	Binary    bool       `json:"binary"`    //True when a text diff cannot be produced
	TooLarge  bool       `json:"tooLarge"`  //True when the file exceeded the diff size limit
	IsNew     bool       `json:"isNew"`     //Path does not exist in the old state
	IsDeleted bool       `json:"isDeleted"` //Path does not exist in the new state
	Additions int        `json:"additions"`
	Deletions int        `json:"deletions"`
	Hunks     []DiffHunk `json:"hunks"`
}

// CloneRequest carries everything needed to clone a repository.
type CloneRequest struct {
	URL      string `json:"url"`
	Dest     string `json:"dest"`     //Real (OS) path of the destination folder
	Branch   string `json:"branch"`   //Optional branch to check out
	Depth    int    `json:"depth"`    //0 for a full clone
	Username string `json:"username"` //HTTPS basic auth user
	Token    string `json:"token"`    //HTTPS personal access token / password
}

// TransportRequest is the shared shape of fetch / pull / push calls.
type TransportRequest struct {
	Remote      string `json:"remote"`      //Defaults to "origin"
	Branch      string `json:"branch"`      //Defaults to the current branch
	Username    string `json:"username"`    //HTTPS basic auth user
	Token       string `json:"token"`       //HTTPS personal access token / password
	Force       bool   `json:"force"`       //Force push
	SetUpstream bool   `json:"setUpstream"` //Configure the pushed branch to track the remote
}

// CommitRequest describes a commit to create.
type CommitRequest struct {
	Message string   `json:"message"`
	Files   []string `json:"files"` //Repo-relative paths to stage before committing; empty means "use the index as-is"
	Name    string   `json:"name"`  //Author name
	Email   string   `json:"email"` //Author email
	All     bool     `json:"all"`   //Stage every tracked modification, like `git commit -a`
}

// Credential is a stored HTTPS credential. Token is never serialised back out
// to the front-end; only the manager reads it.
type Credential struct {
	Host     string `json:"host"`     //Normalised remote host, e.g. "github.com"
	Username string `json:"username"` //HTTPS user name
	Token    string `json:"-"`        //Secret, deliberately not marshalled
}

// OperationResult is the generic success/failure envelope returned by the
// mutating operations so the front-end can branch on AuthRequired.
type OperationResult struct {
	Success      bool   `json:"success"`
	Error        string `json:"error,omitempty"`
	AuthRequired bool   `json:"authRequired,omitempty"` //Remote rejected the credentials (or wanted some)
	Hash         string `json:"hash,omitempty"`         //New commit hash, set by Commit
	Message      string `json:"message,omitempty"`      //Human readable note, e.g. "already up to date"
}
