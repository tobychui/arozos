package wire

/*
	consts.go

	Numbers from [MS-SMB2], [MS-FSCC] and [MS-ERREF]. Only what the server
	uses is listed, so an unused value here is a bug worth a second look.
*/

// Sizes of the fixed parts of a message.
const (
	HeaderSize  = 64
	FileIDSize  = 16
	SignatureAt = 48 //Offset of the signature inside the header
	SignatureSz = 16
)

// Commands
const (
	CmdNegotiate      uint16 = 0x00
	CmdSessionSetup   uint16 = 0x01
	CmdLogoff         uint16 = 0x02
	CmdTreeConnect    uint16 = 0x03
	CmdTreeDisconnect uint16 = 0x04
	CmdCreate         uint16 = 0x05
	CmdClose          uint16 = 0x06
	CmdFlush          uint16 = 0x07
	CmdRead           uint16 = 0x08
	CmdWrite          uint16 = 0x09
	CmdLock           uint16 = 0x0A
	CmdIoctl          uint16 = 0x0B
	CmdCancel         uint16 = 0x0C
	CmdEcho           uint16 = 0x0D
	CmdQueryDirectory uint16 = 0x0E
	CmdChangeNotify   uint16 = 0x0F
	CmdQueryInfo      uint16 = 0x10
	CmdSetInfo        uint16 = 0x11
	CmdOplockBreak    uint16 = 0x12
)

// Header flags
const (
	FlagResponse uint32 = 0x00000001
	FlagAsync    uint32 = 0x00000002
	FlagRelated  uint32 = 0x00000004
	FlagSigned   uint32 = 0x00000008
)

// Dialects
const (
	Dialect202      uint16 = 0x0202
	Dialect210      uint16 = 0x0210
	Dialect300      uint16 = 0x0300
	Dialect302      uint16 = 0x0302
	Dialect311      uint16 = 0x0311
	DialectWildcard uint16 = 0x02FF
)

// Security mode and global capabilities
const (
	SigningEnabled  uint16 = 0x0001
	SigningRequired uint16 = 0x0002

	CapLargeMTU uint32 = 0x00000004
)

// Negotiate contexts
const (
	CtxPreauthIntegrity uint16 = 0x0001
	CtxEncryption       uint16 = 0x0002
	CtxSigning          uint16 = 0x0008

	HashSHA512 uint16 = 0x0001

	SigningHMACSHA256 uint16 = 0x0000
	SigningAESCMAC    uint16 = 0x0001
	SigningAESGMAC    uint16 = 0x0002
)

// Tree connect
const (
	ShareTypeDisk uint8 = 0x01
	ShareTypePipe uint8 = 0x02
)

// Access mask bits
const (
	FileReadData        uint32 = 0x00000001
	FileWriteData       uint32 = 0x00000002
	FileAppendData      uint32 = 0x00000004
	FileReadEA          uint32 = 0x00000008
	FileWriteEA         uint32 = 0x00000010
	FileExecute         uint32 = 0x00000020
	FileDeleteChild     uint32 = 0x00000040
	FileReadAttributes  uint32 = 0x00000080
	FileWriteAttributes uint32 = 0x00000100
	AccessDelete        uint32 = 0x00010000
	ReadControl         uint32 = 0x00020000
	WriteDAC            uint32 = 0x00040000
	WriteOwner          uint32 = 0x00080000
	Synchronize         uint32 = 0x00100000
	AccessSystemSec     uint32 = 0x01000000
	MaximumAllowed      uint32 = 0x02000000
	GenericAll          uint32 = 0x10000000
	GenericExecute      uint32 = 0x20000000
	GenericWrite        uint32 = 0x40000000
	GenericRead         uint32 = 0x80000000

	//The masks generic rights expand to
	FileGenericRead    = ReadControl | FileReadData | FileReadAttributes | FileReadEA | Synchronize
	FileGenericWrite   = ReadControl | FileWriteData | FileWriteAttributes | FileWriteEA | FileAppendData | Synchronize
	FileGenericExecute = ReadControl | FileReadAttributes | FileExecute | Synchronize
	FileAllAccess      = uint32(0x001F01FF)

	//The bits that change a file or its metadata
	WriteAccessMask = FileWriteData | FileAppendData | FileWriteEA | FileWriteAttributes | FileDeleteChild | AccessDelete | WriteDAC | WriteOwner

	//The most a read only user may hold
	ReadOnlyAccess = FileGenericRead | FileExecute
)

// Share access
const (
	ShareRead   uint32 = 0x00000001
	ShareWrite  uint32 = 0x00000002
	ShareDelete uint32 = 0x00000004
)

// Create dispositions
const (
	DispositionSupersede   uint32 = 0
	DispositionOpen        uint32 = 1
	DispositionCreate      uint32 = 2
	DispositionOpenIf      uint32 = 3
	DispositionOverwrite   uint32 = 4
	DispositionOverwriteIf uint32 = 5
)

// Create options
const (
	OptionDirectory    uint32 = 0x00000001
	OptionNonDirectory uint32 = 0x00000040
	OptionDeleteOnCLS  uint32 = 0x00001000
)

// Create actions
const (
	ActionSuperseded  uint32 = 0
	ActionOpened      uint32 = 1
	ActionCreated     uint32 = 2
	ActionOverwritten uint32 = 3
)

// File attributes
const (
	AttrReadOnly  uint32 = 0x00000001
	AttrHidden    uint32 = 0x00000002
	AttrDirectory uint32 = 0x00000010
	AttrArchive   uint32 = 0x00000020
	AttrNormal    uint32 = 0x00000080
)

// Info types of QUERY_INFO and SET_INFO
const (
	InfoFile       uint8 = 1
	InfoFilesystem uint8 = 2
	InfoSecurity   uint8 = 3
	InfoQuota      uint8 = 4
)

// File information classes
const (
	FileDirectoryInformation       uint8 = 1
	FileFullDirectoryInformation   uint8 = 2
	FileBothDirectoryInformation   uint8 = 3
	FileBasicInformation           uint8 = 4
	FileStandardInformation        uint8 = 5
	FileInternalInformation        uint8 = 6
	FileEaInformation              uint8 = 7
	FileAccessInformation          uint8 = 8
	FileNameInformation            uint8 = 9
	FileRenameInformation          uint8 = 10
	FileLinkInformation            uint8 = 11
	FileNamesInformation           uint8 = 12
	FileDispositionInformation     uint8 = 13
	FilePositionInformation        uint8 = 14
	FileModeInformation            uint8 = 16
	FileAlignmentInformation       uint8 = 17
	FileAllInformation             uint8 = 18
	FileAllocationInformation      uint8 = 19
	FileEndOfFileInformation       uint8 = 20
	FileAlternateNameInformation   uint8 = 21
	FileStreamInformation          uint8 = 22
	FileCompressionInformation     uint8 = 28
	FileNetworkOpenInformation     uint8 = 34
	FileAttributeTagInformation    uint8 = 35
	FileIdBothDirectoryInformation uint8 = 37
	FileIdFullDirectoryInformation uint8 = 38
	FileShortNameInformation       uint8 = 40
	FileNormalizedNameInformation  uint8 = 48
	FileIdInformation              uint8 = 59
	FileDispositionInformationEx   uint8 = 64
	FileRenameInformationEx        uint8 = 65
	FileFsVolumeInformation        uint8 = 1
	FileFsSizeInformation          uint8 = 3
	FileFsDeviceInformation        uint8 = 4
	FileFsAttributeInformation     uint8 = 5
	FileFsFullSizeInformation      uint8 = 7
	FileFsObjectIdInformation      uint8 = 8
	FileFsSectorSizeInformation    uint8 = 11
)

// Query directory flags
const (
	RestartScans      uint8 = 0x01
	ReturnSingleEntry uint8 = 0x02
	IndexSpecified    uint8 = 0x04
	Reopen            uint8 = 0x10
)

// Close flags
const CloseFlagPostQuery uint16 = 0x0001

// Lock flags
const (
	LockShared          uint32 = 0x00000001
	LockExclusive       uint32 = 0x00000002
	LockUnlock          uint32 = 0x00000004
	LockFailImmediately uint32 = 0x00000010
)

// IOCTL codes
const (
	FsctlGetObjectID           uint32 = 0x0009009C
	FsctlDeleteObjectID        uint32 = 0x000900A0
	FsctlCreateOrGetObjectID   uint32 = 0x000900C0
	FsctlDfsGetReferrals       uint32 = 0x00060194
	FsctlDfsGetReferralsEx     uint32 = 0x000601B0
	FsctlPipeTransceive        uint32 = 0x0011C017
	FsctlValidateNegotiateInfo uint32 = 0x00140204
	FsctlEnumerateSnapshots    uint32 = 0x00144064

	IoctlIsFsctl uint32 = 0x00000001
)

// Create context names
const (
	ContextMaximalAccess = "MxAc"
	ContextQueryOnDiskID = "QFid"
	ContextDurableReq    = "DHnQ"
	ContextDurableReqV2  = "DH2Q"
	ContextDurableRecon  = "DHnC"
	ContextDurableRecon2 = "DH2C"
	ContextTimewarp      = "TWrp"
)

// NT status codes
const (
	StatusOK                     uint32 = 0x00000000
	StatusPending                uint32 = 0x00000103
	StatusNotifyCleanup          uint32 = 0x0000010B
	StatusBufferOverflow         uint32 = 0x80000005
	StatusNoMoreFiles            uint32 = 0x80000006
	StatusUnsuccessful           uint32 = 0xC0000001
	StatusNotImplemented         uint32 = 0xC0000002
	StatusInvalidInfoClass       uint32 = 0xC0000003
	StatusInfoLengthMismatch     uint32 = 0xC0000004
	StatusInvalidHandle          uint32 = 0xC0000008
	StatusInvalidParameter       uint32 = 0xC000000D
	StatusNoSuchFile             uint32 = 0xC000000F
	StatusInvalidDeviceRequest   uint32 = 0xC0000010
	StatusEndOfFile              uint32 = 0xC0000011
	StatusMoreProcessingRequired uint32 = 0xC0000016
	StatusAccessDenied           uint32 = 0xC0000022
	StatusBufferTooSmall         uint32 = 0xC0000023
	StatusObjectNameInvalid      uint32 = 0xC0000033
	StatusObjectNameNotFound     uint32 = 0xC0000034
	StatusObjectNameCollision    uint32 = 0xC0000035
	StatusObjectPathNotFound     uint32 = 0xC000003A
	StatusObjectPathSyntaxBad    uint32 = 0xC000003B
	StatusSharingViolation       uint32 = 0xC0000043
	StatusFileLockConflict       uint32 = 0xC0000054
	StatusLockNotGranted         uint32 = 0xC0000055
	StatusDeletePending          uint32 = 0xC0000056
	StatusPrivilegeNotHeld       uint32 = 0xC0000061
	StatusLogonFailure           uint32 = 0xC000006D
	StatusRangeNotLocked         uint32 = 0xC000007E
	StatusDiskFull               uint32 = 0xC000007F
	StatusInsufficientResources  uint32 = 0xC000009A
	StatusPipeDisconnected       uint32 = 0xC00000B0
	StatusFileIsADirectory       uint32 = 0xC00000BA
	StatusNotSupported           uint32 = 0xC00000BB
	StatusBadNetworkName         uint32 = 0xC00000CC
	StatusRequestNotAccepted     uint32 = 0xC00000D0
	StatusInternalError          uint32 = 0xC00000E5
	StatusDirectoryNotEmpty      uint32 = 0xC0000101
	StatusNotADirectory          uint32 = 0xC0000103
	StatusCancelled              uint32 = 0xC0000120
	StatusFileClosed             uint32 = 0xC0000128
	StatusUserSessionDeleted     uint32 = 0xC0000203
	StatusNotFound               uint32 = 0xC0000225
	StatusNetworkNameDeleted     uint32 = 0xC00000C9
	StatusInvalidOplockProtocol  uint32 = 0xC00000E3
)

// IsError reports whether a status ends the request. Warnings such as
// STATUS_BUFFER_OVERFLOW still carry a normal body.
func IsError(status uint32) bool {
	return status&0xC0000000 == 0xC0000000
}
