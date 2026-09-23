package arozfs

/*
	storageinfo.go

	Where a file physically lives.

	os.FileInfo describes a file as the abstraction presents it: a name, a
	size and a time. It says nothing about where the bytes actually are,
	which for most file systems is obvious (the disk behind the drive) but
	not for one that spreads its files over several hosts: a file on the
	cluster drive is kept on whichever nodes the replica policy placed it,
	and a user looking at its properties cannot tell which those are.

	A file system abstraction that knows more implements StorageInfoProvider
	and answers in the shape below. It is deliberately a list of rows and a
	list of locations rather than a cluster specific structure, so the File
	Manager properties dialog can render whatever any abstraction reports
	without knowing what kind of drive it came from.
*/

// Location states, for the colour the front end gives an entry
const (
	StorageStateOK      = "ok"      //readable and up to date
	StorageStatePending = "pending" //being written or copied right now
	StorageStateStale   = "stale"   //present but out of date
	StorageStateError   = "error"   //unusable
	StorageStateUnknown = "unknown"
)

// StorageInfoField is one key/value row. Both sides are English text: the
// front end translates the ones it has a string for and shows the rest as
// they are, so an abstraction may report values (paths, hashes, node names)
// that no locale file can know in advance. Anything that mixes wording with
// data says so through Args, where Value is a template ("{0} copies") whose
// slots are filled after it has been translated, so the wording and the
// number can swap places in the languages that need them to.
type StorageInfoField struct {
	Key   string   `json:"key"`
	Value string   `json:"value"`
	Args  []string `json:"args,omitempty"`
}

// StorageInfoItem is one physical location of the file: on the cluster drive
// one replica, on another abstraction whatever a location means there.
type StorageInfoItem struct {
	Title    string             `json:"title"`    //what holds the copy, e.g. the node name
	Subtitle string             `json:"subtitle"` //where inside it, e.g. the volume name
	State    string             `json:"state"`    //one of the StorageState constants
	Status   string             `json:"status"`   //the state in words
	Local    bool               `json:"local"`    //true when this host holds this copy
	Fields   []StorageInfoField `json:"fields"`
}

// StorageInfo is everything an abstraction can tell about one file beyond
// its os.FileInfo.
type StorageInfo struct {
	Type   string             `json:"type"`   //file system type, e.g. "cluster"
	Title  string             `json:"title"`  //heading for the section, e.g. "Cluster"
	Fields []StorageInfoField `json:"fields"` //properties of the file as a whole
	Items  []StorageInfoItem  `json:"items"`  //one entry per physical location
}

// StorageInfoProvider is implemented by file system abstractions that can
// resolve where and how a file is stored. Abstractions that cannot are simply
// left out: the properties dialog then shows its usual rows only.
type StorageInfoProvider interface {
	StorageInfo(realpath string) (StorageInfo, error)
}
