package smbserver

import (
	"encoding/binary"
	"fmt"
	"hash/crc32"
	"strings"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

// Volume attributes reported in FileFsAttributeInformation. Named streams and
// sparse files are left out on purpose, because they are not implemented.
const (
	fsCaseSensitiveSearch uint32 = 0x00000001
	fsCasePreservedNames  uint32 = 0x00000002
	fsUnicodeOnDisk       uint32 = 0x00000004
	fsPersistentACLs      uint32 = 0x00000008
	fsObjectIDs           uint32 = 0x00010000
	fsReadOnlyVolume      uint32 = 0x00080000
)

const (
	sectorSize     = 512
	sectorsPerUnit = 8
	clusterSize    = sectorSize * sectorsPerUnit
)

func volumeSerial(s Share) uint64 {
	return uint64(crc32.ChecksumIEEE([]byte(s.Key())))
}

func (c *conn) handleQueryInfo(r *request) *response {
	q, err := wire.ParseQueryInfo(r.raw)
	if err != nil {
		return errorResponse(wire.StatusInvalidParameter)
	}
	if !r.checkCharge(uint64(q.MaxOutput)) {
		return errorResponse(wire.StatusInvalidParameter)
	}
	r.detail = fmt.Sprintf("type=%d class=%d max=%d ", q.InfoType, q.Class, q.MaxOutput)
	o, status := r.open(q.FileID)
	if status != wire.StatusOK {
		return errorResponse(status)
	}

	if o.pipe != nil {
		return queryPipe(q)
	}

	//Asked per operation, so a revoked drive stops answering on open handles
	if !o.tree.share.CanRead(o.getPath()) {
		return errorResponse(wire.StatusAccessDenied)
	}

	switch q.InfoType {
	case wire.InfoFile:
		return c.queryFile(o, q)
	case wire.InfoFilesystem:
		return queryFilesystem(o, q)
	case wire.InfoSecurity:
		return c.querySecurity(o, q)
	}
	return errorResponse(wire.StatusNotSupported)
}

func infoResponse(data []byte, max uint32, variable bool) *response {
	status := uint32(wire.StatusOK)
	if uint32(len(data)) > max {
		if !variable {
			return errorResponse(wire.StatusInfoLengthMismatch)
		}
		data = data[:max]
		status = wire.StatusBufferOverflow
	}
	w := wire.NewWriter(8 + len(data))
	w.U16(9)
	w.U16(wire.HeaderSize + 8)
	w.U32(uint32(len(data)))
	w.Bytes(data)
	return &response{status: status, body: w.B}
}

func queryPipe(q *wire.QueryInfoRequest) *response {
	if q.InfoType == wire.InfoFile && q.Class == wire.FileStandardInformation {
		w := wire.NewWriter(24)
		w.U64(4096)
		w.U64(0)
		w.U32(1)
		w.U8(1) //Delete pending, as Windows reports for a pipe
		w.U8(0)
		w.U16(0)
		return infoResponse(w.B, q.MaxOutput, false)
	}
	return errorResponse(wire.StatusInvalidInfoClass)
}

func putTimes(w *wire.Writer, info FileInfo) {
	w.U64(wire.Filetime(birthOf(info)))
	w.U64(wire.Filetime(info.ModTime))
	w.U64(wire.Filetime(info.ModTime))
	w.U64(wire.Filetime(info.ModTime))
}

func (o *open) standardInfo(w *wire.Writer, info FileInfo) {
	size := info.Size
	if info.IsDir {
		size = 0
	}
	w.U64(allocationOf(size))
	w.U64(uint64(size))
	w.U32(1)
	if o.handle.DeletePending() {
		w.U8(1)
	} else {
		w.U8(0)
	}
	if info.IsDir {
		w.U8(1)
	} else {
		w.U8(0)
	}
	w.U16(0)
}

func (c *conn) queryFile(o *open, q *wire.QueryInfoRequest) *response {
	//Only these reveal attributes. Windows opens a file with DELETE alone and
	//still asks for its standard information before removing it.
	switch q.Class {
	case wire.FileBasicInformation, wire.FileAllInformation, wire.FileNetworkOpenInformation, wire.FileAttributeTagInformation:
		if o.access&wire.FileReadAttributes == 0 {
			return errorResponse(wire.StatusAccessDenied)
		}
	}
	share := o.tree.share
	p := o.getPath()
	info, err := share.Stat(p)
	if err != nil {
		return errorResponse(statusOf(err))
	}
	info.Name = baseName(p)

	w := wire.NewWriter(128)
	variable := false
	switch q.Class {
	case wire.FileBasicInformation:
		putTimes(w, info)
		w.U32(attributesOf(info))
		w.U32(0)
	case wire.FileStandardInformation:
		o.standardInfo(w, info)
	case wire.FileInternalInformation:
		w.U64(fileNumber(share, p, info))
	case wire.FileEaInformation:
		w.U32(0)
	case wire.FileAccessInformation:
		w.U32(o.access)
	case wire.FilePositionInformation:
		w.U64(0)
	case wire.FileModeInformation:
		w.U32(0)
	case wire.FileAlignmentInformation:
		w.U32(0)
	case wire.FileAllInformation:
		putTimes(w, info)
		w.U32(attributesOf(info))
		w.U32(0)
		o.standardInfo(w, info)
		w.U64(fileNumber(share, p, info))
		w.U32(0)
		w.U32(o.access)
		w.U64(0)
		w.U32(0)
		w.U32(0)
		name := wire.EncodeUTF16(`\` + wirePath(p))
		w.U32(uint32(len(name)))
		w.Bytes(name)
		variable = true
	case wire.FileNormalizedNameInformation:
		name := wire.EncodeUTF16(wirePath(p))
		w.U32(uint32(len(name)))
		w.Bytes(name)
		variable = true
	case wire.FileNetworkOpenInformation:
		putTimes(w, info)
		size := info.Size
		if info.IsDir {
			size = 0
		}
		w.U64(allocationOf(size))
		w.U64(uint64(size))
		w.U32(attributesOf(info))
		w.U32(0)
	case wire.FileAttributeTagInformation:
		w.U32(attributesOf(info))
		w.U32(0)
	case wire.FileStreamInformation:
		variable = true
		if !info.IsDir {
			name := wire.EncodeUTF16("::$DATA")
			w.U32(0)
			w.U32(uint32(len(name)))
			w.U64(uint64(info.Size))
			w.U64(allocationOf(info.Size))
			w.Bytes(name)
		}
	case wire.FileIdInformation:
		w.U64(volumeSerial(share))
		w.U64(fileNumber(share, p, info))
		w.U64(0)
	case wire.FileCompressionInformation:
		w.U64(uint64(info.Size))
		w.Zero(8)
	case wire.FileAlternateNameInformation:
		//There are no 8.3 names
		return errorResponse(wire.StatusObjectNameNotFound)
	default:
		return errorResponse(wire.StatusInvalidInfoClass)
	}
	return infoResponse(w.B, q.MaxOutput, variable)
}

// wirePath turns a share path into the backslashed form Windows expects,
// passing each name through the same mapping as a listing.
func wirePath(p string) string {
	parts := strings.Split(p, "/")
	for i, part := range parts {
		parts[i] = toWireName(part)
	}
	return strings.Join(parts, `\`)
}

func queryFilesystem(o *open, q *wire.QueryInfoRequest) *response {
	share := o.tree.share
	w := wire.NewWriter(64)
	variable := false
	switch q.Class {
	case wire.FileFsVolumeInformation:
		label := wire.EncodeUTF16(share.Name())
		w.U64(0)
		w.U32(uint32(volumeSerial(share)))
		w.U32(uint32(len(label)))
		w.U8(0)
		w.U8(0)
		w.Bytes(label)
		variable = true
	case wire.FileFsSizeInformation:
		total, free := share.Usage()
		w.U64(total / clusterSize)
		w.U64(free / clusterSize)
		w.U32(sectorsPerUnit)
		w.U32(sectorSize)
	case wire.FileFsFullSizeInformation:
		total, free := share.Usage()
		w.U64(total / clusterSize)
		w.U64(free / clusterSize)
		w.U64(free / clusterSize)
		w.U32(sectorsPerUnit)
		w.U32(sectorSize)
	case wire.FileFsDeviceInformation:
		w.U32(0x00000007) //FILE_DEVICE_DISK
		w.U32(0)
	case wire.FileFsAttributeInformation:
		flags := fsCaseSensitiveSearch | fsCasePreservedNames | fsUnicodeOnDisk | fsPersistentACLs | fsObjectIDs
		if share.ReadOnly() {
			flags |= fsReadOnlyVolume
		}
		name := wire.EncodeUTF16("NTFS")
		w.U32(flags)
		w.U32(maxNameComponent)
		w.U32(uint32(len(name)))
		w.Bytes(name)
		variable = true
	case wire.FileFsObjectIdInformation:
		id := volumeObjectID(share)
		w.Bytes(id[:])
		w.Zero(48)
	case wire.FileFsSectorSizeInformation:
		for i := 0; i < 4; i++ {
			w.U32(sectorSize)
		}
		w.U32(0x03) //Aligned device, partition aligned
		w.U32(0)
		w.U32(0)
	default:
		return errorResponse(wire.StatusInvalidInfoClass)
	}
	return infoResponse(w.B, q.MaxOutput, variable)
}

// Security information bits
const (
	secOwner uint32 = 0x00000001
	secGroup uint32 = 0x00000002
	secDACL  uint32 = 0x00000004
)

// buildDescriptor makes a self relative security descriptor. It only says what
// the connected user may do: access is decided by ArozOS, never by these bytes.
func buildDescriptor(owner, group wire.SID, mask, selector uint32) []byte {
	const (
		selfRelative  = 0x8000
		daclProtected = 0x1000
		daclPresent   = 0x0004
		fixed         = 20
	)
	control := uint16(selfRelative)
	body := wire.NewWriter(96)
	var ownerAt, groupAt, daclAt uint32

	if selector&secOwner != 0 {
		ownerAt = fixed + uint32(body.Len())
		body.Bytes(owner.Bytes())
	}
	if selector&secGroup != 0 {
		groupAt = fixed + uint32(body.Len())
		body.Bytes(group.Bytes())
	}
	if selector&secDACL != 0 {
		control |= daclPresent | daclProtected
		daclAt = fixed + uint32(body.Len())
		sid := owner.Bytes()
		aceSize := 8 + len(sid)
		body.U8(2) //ACL revision
		body.U8(0)
		body.U16(uint16(8 + aceSize))
		body.U16(1)
		body.U16(0)
		body.U8(0) //Access allowed
		body.U8(0)
		body.U16(uint16(aceSize))
		body.U32(mask)
		body.Bytes(sid)
	}

	w := wire.NewWriter(fixed + body.Len())
	w.U8(1)
	w.U8(0)
	w.U16(control)
	w.U32(ownerAt)
	w.U32(groupAt)
	w.U32(0)
	w.U32(daclAt)
	w.Bytes(body.B)
	return w.B
}

func (c *conn) querySecurity(o *open, q *wire.QueryInfoRequest) *response {
	if o.access&wire.ReadControl == 0 {
		return errorResponse(wire.StatusAccessDenied)
	}
	owner := wire.UserSID(c.srv.machineSID, o.sess.username)
	data := buildDescriptor(owner, wire.SIDUsers, maximalAccess(o.tree.share, o.getPath()), q.Additional)
	if uint32(len(data)) > q.MaxOutput {
		need := make([]byte, 4)
		binary.LittleEndian.PutUint32(need, uint32(len(data)))
		return &response{status: wire.StatusBufferTooSmall, errData: need}
	}
	return infoResponse(data, q.MaxOutput, false)
}

func (c *conn) handleSetInfo(r *request) *response {
	q, err := wire.ParseSetInfo(r.raw)
	if err != nil {
		return errorResponse(wire.StatusInvalidParameter)
	}
	if !r.checkCharge(uint64(len(q.Data))) {
		return errorResponse(wire.StatusInvalidParameter)
	}
	r.detail = fmt.Sprintf("type=%d class=%d ", q.InfoType, q.Class)
	o, status := r.open(q.FileID)
	if status != wire.StatusOK {
		return errorResponse(status)
	}
	if o.pipe != nil {
		return errorResponse(wire.StatusNotSupported)
	}

	var st uint32
	switch q.InfoType {
	case wire.InfoFile:
		st = c.setFile(o, q)
	case wire.InfoSecurity:
		//Accepted and ignored: ArozOS access lists decide, not Windows ACLs
		st = wire.StatusOK
		if !writable(o.tree.share, o.getPath()) {
			st = wire.StatusAccessDenied
		}
	default:
		st = wire.StatusNotSupported
	}
	if st != wire.StatusOK {
		return errorResponse(st)
	}
	return &response{body: []byte{2, 0}}
}

func (c *conn) setFile(o *open, q *wire.SetInfoRequest) uint32 {
	switch q.Class {
	case wire.FileBasicInformation:
		return c.setBasic(o, q.Data)
	case wire.FileEndOfFileInformation:
		return c.setEndOfFile(o, q.Data, false)
	case wire.FileAllocationInformation:
		return c.setEndOfFile(o, q.Data, true)
	case wire.FileDispositionInformation:
		if len(q.Data) < 1 {
			return wire.StatusInfoLengthMismatch
		}
		return c.setDisposition(o, q.Data[0] != 0)
	case wire.FileDispositionInformationEx:
		if len(q.Data) < 4 {
			return wire.StatusInfoLengthMismatch
		}
		return c.setDisposition(o, binary.LittleEndian.Uint32(q.Data)&0x01 != 0)
	case wire.FileRenameInformation, wire.FileRenameInformationEx:
		return c.setRename(o, q)
	case wire.FileLinkInformation:
		return wire.StatusNotSupported
	case wire.FilePositionInformation, wire.FileModeInformation, wire.FileShortNameInformation:
		return wire.StatusOK
	}
	return wire.StatusInvalidInfoClass
}

func (c *conn) setBasic(o *open, data []byte) uint32 {
	if len(data) < 40 {
		return wire.StatusInfoLengthMismatch
	}
	if o.access&wire.FileWriteAttributes == 0 {
		return wire.StatusAccessDenied
	}
	share := o.tree.share
	p := o.getPath()
	if !writable(share, p) {
		return wire.StatusAccessDenied
	}
	//Zero leaves a time alone, and all ones means "stop updating it"
	modified := binary.LittleEndian.Uint64(data[16:])
	if modified == 0 || modified == ^uint64(0) {
		return wire.StatusOK
	}
	when := wire.TimeFromFiletime(modified)
	if err := share.SetModTime(p, when); err != nil {
		return statusOf(err)
	}
	o.metaMu.Lock()
	o.stickyMod = when
	o.metaMu.Unlock()
	return wire.StatusOK
}

func (c *conn) setEndOfFile(o *open, data []byte, allocation bool) uint32 {
	if len(data) < 8 {
		return wire.StatusInfoLengthMismatch
	}
	if o.isDir {
		return wire.StatusInvalidParameter
	}
	if o.access&wire.FileWriteData == 0 || o.file == nil {
		return wire.StatusAccessDenied
	}
	size := int64(binary.LittleEndian.Uint64(data))
	if size < 0 {
		return wire.StatusInvalidParameter
	}

	o.io.RLock()
	defer o.io.RUnlock()
	if o.closed {
		return wire.StatusFileClosed
	}
	share := o.tree.share
	if !writable(share, o.getPath()) {
		return wire.StatusAccessDenied
	}

	o.metaMu.Lock()
	current := o.size
	o.metaMu.Unlock()

	//Space reserved ahead of a copy is only a hint, unless it shrinks the file
	if allocation && size >= current {
		return wire.StatusOK
	}
	if growth := size - current; growth > 0 && !share.HaveSpace(growth) {
		return wire.StatusDiskFull
	}
	if err := o.file.Truncate(size); err != nil {
		return statusOf(err)
	}
	o.metaMu.Lock()
	o.size = size
	o.dirty = true
	o.metaMu.Unlock()
	return wire.StatusOK
}

func (c *conn) setDisposition(o *open, pending bool) uint32 {
	if o.access&wire.AccessDelete == 0 {
		return wire.StatusAccessDenied
	}
	share := o.tree.share
	p := o.getPath()
	if p == "" || !writable(share, p) {
		return wire.StatusAccessDenied
	}
	if pending && o.isDir {
		list, err := share.ReadDir(p)
		if err != nil {
			return statusOf(err)
		}
		if len(list) > 0 {
			return wire.StatusDirectoryNotEmpty
		}
	}
	o.handle.SetDisposition(pending)
	return wire.StatusOK
}

func (c *conn) setRename(o *open, q *wire.SetInfoRequest) uint32 {
	if len(q.Data) < 20 {
		return wire.StatusInfoLengthMismatch
	}
	if o.access&wire.AccessDelete == 0 {
		return wire.StatusAccessDenied
	}
	replace := q.Data[0] != 0
	if q.Class == wire.FileRenameInformationEx {
		replace = binary.LittleEndian.Uint32(q.Data)&0x01 != 0
	}
	length := int(binary.LittleEndian.Uint32(q.Data[16:]))
	if length < 0 || length > len(q.Data)-20 {
		return wire.StatusInvalidParameter
	}
	rawName, ok := wire.DecodeUTF16(q.Data[20 : 20+length])
	if !ok {
		return wire.StatusInvalidParameter
	}
	rel, status := parsePath(rawName)
	if status != wire.StatusOK {
		return status
	}
	if rel == "" {
		return wire.StatusObjectNameInvalid
	}

	share := o.tree.share
	source := o.getPath()
	if source == "" {
		return wire.StatusAccessDenied
	}

	//Walk to the real parent folder, but keep the new name exactly as typed:
	//it may differ from the old one by nothing except case
	parent := ""
	if d := dirName(rel); d != "" {
		res, err := resolve(share, c.srv.names, d)
		if err != nil {
			return statusOf(err)
		}
		if !res.exists || !res.info.IsDir {
			return wire.StatusObjectPathNotFound
		}
		parent = res.path
	}
	target := joinPath(parent, baseName(rel))

	if !writable(share, source) || !writable(share, target) {
		return wire.StatusAccessDenied
	}

	sameFile := strings.EqualFold(source, target)
	if !sameFile {
		res, err := resolve(share, c.srv.names, target)
		if err != nil {
			return statusOf(err)
		}
		if res.exists {
			if !replace {
				return wire.StatusObjectNameCollision
			}
			if res.info.IsDir {
				return wire.StatusAccessDenied
			}
		}
	}

	newKey := fileKey(share, target)
	if st := o.handle.CanRename(newKey); st != wire.StatusOK {
		return st
	}
	if err := share.Rename(source, target); err != nil {
		return statusOf(err)
	}
	o.handle.Rename(newKey, target)
	c.srv.names.forget(share, dirName(source))
	c.srv.names.forget(share, dirName(target))
	return wire.StatusOK
}
