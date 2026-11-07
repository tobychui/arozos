package wire

import "bytes"

/*
	requests.go

	One parser per request body. Each takes the whole message, header
	included, because SMB2 offsets count from the start of the header.
*/

func body(msg []byte) *Reader {
	if len(msg) < HeaderSize {
		return NewReader(nil)
	}
	return NewReader(msg[HeaderSize:])
}

// FileID is the 16 byte handle of an open.
type FileID [FileIDSize]byte

// IsPrevious reports the all ones value that means "the file the previous
// request in this compound used".
func (f FileID) IsPrevious() bool {
	for _, v := range f {
		if v != 0xFF {
			return false
		}
	}
	return true
}

func readFileID(r *Reader) FileID {
	var f FileID
	copy(f[:], r.Bytes(FileIDSize))
	return f
}

// NegotiateContext is one entry of the SMB 3.1.1 negotiate context list.
type NegotiateContext struct {
	Type uint16
	Data []byte
}

// NegotiateRequest is the SMB2 NEGOTIATE body.
type NegotiateRequest struct {
	SecurityMode uint16
	Capabilities uint32
	ClientGUID   [16]byte
	Dialects     []uint16
	Contexts     []NegotiateContext
}

// ParseNegotiate reads a NEGOTIATE request.
func ParseNegotiate(msg []byte) (*NegotiateRequest, error) {
	r := body(msg)
	if r.U16() != 36 {
		return nil, ErrMalformed
	}
	count := int(r.U16())
	q := &NegotiateRequest{SecurityMode: r.U16()}
	r.Skip(2)
	q.Capabilities = r.U32()
	copy(q.ClientGUID[:], r.Bytes(16))
	ctxOffset := int(r.U32())
	ctxCount := int(r.U16())
	r.Skip(2)
	if r.Bad() || count == 0 || count > 64 {
		return nil, ErrMalformed
	}
	for i := 0; i < count; i++ {
		q.Dialects = append(q.Dialects, r.U16())
	}
	if r.Bad() {
		return nil, ErrMalformed
	}

	hasDialect311 := false
	for _, d := range q.Dialects {
		if d == Dialect311 {
			hasDialect311 = true
		}
	}
	if !hasDialect311 || ctxCount == 0 {
		return q, nil
	}

	//The contexts are only defined when 3.1.1 is on offer
	if ctxCount > 32 || ctxOffset < HeaderSize || ctxOffset > len(msg) {
		return nil, ErrMalformed
	}
	c := NewReader(msg[ctxOffset:])
	for i := 0; i < ctxCount; i++ {
		c.Align(8)
		t := c.U16()
		n := int(c.U16())
		c.Skip(4)
		data := c.Bytes(n)
		if c.Bad() {
			return nil, ErrMalformed
		}
		q.Contexts = append(q.Contexts, NegotiateContext{Type: t, Data: data})
	}
	return q, nil
}

// PreauthContext is the data of SMB2_PREAUTH_INTEGRITY_CAPABILITIES.
func PreauthHashes(data []byte) ([]uint16, bool) {
	r := NewReader(data)
	count := int(r.U16())
	r.Skip(2) //Salt length
	if r.Bad() || count == 0 || count > 16 {
		return nil, false
	}
	out := make([]uint16, 0, count)
	for i := 0; i < count; i++ {
		out = append(out, r.U16())
	}
	return out, !r.Bad()
}

// SigningAlgorithms is the data of SMB2_SIGNING_CAPABILITIES.
func SigningAlgorithms(data []byte) ([]uint16, bool) {
	r := NewReader(data)
	count := int(r.U16())
	if r.Bad() || count == 0 || count > 16 {
		return nil, false
	}
	out := make([]uint16, 0, count)
	for i := 0; i < count; i++ {
		out = append(out, r.U16())
	}
	return out, !r.Bad()
}

// ParseMultiProtocol reads an SMB1 NEGOTIATE and returns the dialect strings
// of its opening. Windows and macOS both start this way, and it is the only
// SMB1 message the server looks at.
func ParseMultiProtocol(frame []byte) ([]string, error) {
	const smb1HeaderSize = 32
	if len(frame) < smb1HeaderSize+3 || !IsSMB1(frame) || frame[4] != 0x72 {
		return nil, ErrMalformed
	}
	r := NewReader(frame[smb1HeaderSize:])
	r.Skip(1) //Word count, zero
	n := int(r.U16())
	data := r.Bytes(n)
	if r.Bad() {
		return nil, ErrMalformed
	}
	out := []string{}
	for _, chunk := range bytes.Split(data, []byte{0}) {
		if len(chunk) > 1 && chunk[0] == 0x02 {
			out = append(out, string(chunk[1:]))
		}
	}
	return out, nil
}

// SessionSetupRequest is the SESSION_SETUP body.
type SessionSetupRequest struct {
	Flags             uint8
	SecurityMode      uint8
	Capabilities      uint32
	PreviousSessionID uint64
	Token             []byte
}

// ParseSessionSetup reads a SESSION_SETUP request.
func ParseSessionSetup(msg []byte) (*SessionSetupRequest, error) {
	r := body(msg)
	if r.U16() != 25 {
		return nil, ErrMalformed
	}
	q := &SessionSetupRequest{Flags: r.U8(), SecurityMode: r.U8()}
	q.Capabilities = r.U32()
	r.Skip(4) //Channel
	off := int(r.U16())
	n := int(r.U16())
	q.PreviousSessionID = r.U64()
	if r.Bad() {
		return nil, ErrMalformed
	}
	token, ok := Slice(msg, off, n)
	if !ok {
		return nil, ErrMalformed
	}
	q.Token = token
	return q, nil
}

// ParseTreeConnect reads a TREE_CONNECT request and returns its UNC path.
func ParseTreeConnect(msg []byte) (string, error) {
	r := body(msg)
	if r.U16() != 9 {
		return "", ErrMalformed
	}
	r.Skip(2)
	off := int(r.U16())
	n := int(r.U16())
	if r.Bad() {
		return "", ErrMalformed
	}
	raw, ok := Slice(msg, off, n)
	if !ok {
		return "", ErrMalformed
	}
	path, ok := DecodeUTF16(raw)
	if !ok {
		return "", ErrMalformed
	}
	return path, nil
}

// CreateContext is one entry of a CREATE context chain.
type CreateContext struct {
	Name string
	Data []byte
}

// CreateRequest is the CREATE body.
type CreateRequest struct {
	OplockLevel   uint8
	DesiredAccess uint32
	Attributes    uint32
	ShareAccess   uint32
	Disposition   uint32
	Options       uint32
	Name          string
	Contexts      []CreateContext
}

// ParseCreate reads a CREATE request.
func ParseCreate(msg []byte) (*CreateRequest, error) {
	r := body(msg)
	if r.U16() != 57 {
		return nil, ErrMalformed
	}
	r.Skip(1) //Security flags
	q := &CreateRequest{OplockLevel: r.U8()}
	r.Skip(4 + 8 + 8) //Impersonation, create flags, reserved
	q.DesiredAccess = r.U32()
	q.Attributes = r.U32()
	q.ShareAccess = r.U32()
	q.Disposition = r.U32()
	q.Options = r.U32()
	nameOff := int(r.U16())
	nameLen := int(r.U16())
	ctxOff := int(r.U32())
	ctxLen := int(r.U32())
	if r.Bad() {
		return nil, ErrMalformed
	}
	rawName, ok := Slice(msg, nameOff, nameLen)
	if !ok {
		return nil, ErrMalformed
	}
	if q.Name, ok = DecodeUTF16(rawName); !ok {
		return nil, ErrMalformed
	}
	if ctxLen == 0 {
		return q, nil
	}
	chain, ok := Slice(msg, ctxOff, ctxLen)
	if !ok {
		return nil, ErrMalformed
	}
	for count := 0; ; count++ {
		if count > 32 || len(chain) < 16 {
			return nil, ErrMalformed
		}
		c := NewReader(chain)
		next := int(c.U32())
		nameOffset := int(c.U16())
		nameLength := int(c.U16())
		c.Skip(2)
		dataOffset := int(c.U16())
		dataLength := int(c.U32())
		if c.Bad() || nameLength > len(chain) || nameOffset > len(chain)-nameLength {
			return nil, ErrMalformed
		}
		var data []byte
		if dataLength > 0 {
			if dataLength > len(chain) || dataOffset > len(chain)-dataLength {
				return nil, ErrMalformed
			}
			data = chain[dataOffset : dataOffset+dataLength]
		}
		q.Contexts = append(q.Contexts, CreateContext{Name: string(chain[nameOffset : nameOffset+nameLength]), Data: data})
		if next == 0 {
			return q, nil
		}
		if next < 16 || next > len(chain) || next%8 != 0 {
			return nil, ErrMalformed
		}
		chain = chain[next:]
	}
}

// ParseClose reads a CLOSE request.
func ParseClose(msg []byte) (uint16, FileID, error) {
	r := body(msg)
	if r.U16() != 24 {
		return 0, FileID{}, ErrMalformed
	}
	flags := r.U16()
	r.Skip(4)
	id := readFileID(r)
	if r.Bad() {
		return 0, FileID{}, ErrMalformed
	}
	return flags, id, nil
}

// ParseFlush reads a FLUSH request.
func ParseFlush(msg []byte) (FileID, error) {
	r := body(msg)
	if r.U16() != 24 {
		return FileID{}, ErrMalformed
	}
	r.Skip(6)
	id := readFileID(r)
	if r.Bad() {
		return FileID{}, ErrMalformed
	}
	return id, nil
}

// ReadRequest is the READ body.
type ReadRequest struct {
	Length   uint32
	Offset   uint64
	FileID   FileID
	MinCount uint32
}

// ParseRead reads a READ request.
func ParseRead(msg []byte) (*ReadRequest, error) {
	r := body(msg)
	if r.U16() != 49 {
		return nil, ErrMalformed
	}
	r.Skip(2) //Padding, flags
	q := &ReadRequest{Length: r.U32(), Offset: r.U64()}
	q.FileID = readFileID(r)
	q.MinCount = r.U32()
	if r.Bad() {
		return nil, ErrMalformed
	}
	return q, nil
}

// WriteRequest is the WRITE body.
type WriteRequest struct {
	Offset uint64
	FileID FileID
	Data   []byte
}

// ParseWrite reads a WRITE request.
func ParseWrite(msg []byte) (*WriteRequest, error) {
	r := body(msg)
	if r.U16() != 49 {
		return nil, ErrMalformed
	}
	dataOff := int(r.U16())
	length := int(r.U32())
	q := &WriteRequest{Offset: r.U64()}
	q.FileID = readFileID(r)
	if r.Bad() {
		return nil, ErrMalformed
	}
	data, ok := Slice(msg, dataOff, length)
	if !ok {
		return nil, ErrMalformed
	}
	q.Data = data
	return q, nil
}

// LockElement is one range of a LOCK request.
type LockElement struct {
	Offset uint64
	Length uint64
	Flags  uint32
}

// LockRequest is the LOCK body.
type LockRequest struct {
	FileID FileID
	Locks  []LockElement
}

// ParseLock reads a LOCK request. The element array starts 24 bytes into the
// body, which is the offset a self written client can easily get wrong in
// the same way as the server and hide.
func ParseLock(msg []byte) (*LockRequest, error) {
	r := body(msg)
	if r.U16() != 48 {
		return nil, ErrMalformed
	}
	count := int(r.U16())
	r.Skip(4)
	q := &LockRequest{FileID: readFileID(r)}
	if r.Bad() || count == 0 || count > 4096 {
		return nil, ErrMalformed
	}
	for i := 0; i < count; i++ {
		e := LockElement{Offset: r.U64(), Length: r.U64(), Flags: r.U32()}
		r.Skip(4)
		q.Locks = append(q.Locks, e)
	}
	if r.Bad() {
		return nil, ErrMalformed
	}
	return q, nil
}

// IoctlRequest is the IOCTL body.
type IoctlRequest struct {
	CtlCode           uint32
	FileID            FileID
	Input             []byte
	MaxOutputResponse uint32
	Flags             uint32
}

// ParseIoctl reads an IOCTL request.
func ParseIoctl(msg []byte) (*IoctlRequest, error) {
	r := body(msg)
	if r.U16() != 57 {
		return nil, ErrMalformed
	}
	r.Skip(2)
	q := &IoctlRequest{CtlCode: r.U32()}
	q.FileID = readFileID(r)
	inOff := int(r.U32())
	inLen := int(r.U32())
	r.Skip(4 + 4 + 4) //Max input response, output offset, output count
	q.MaxOutputResponse = r.U32()
	q.Flags = r.U32()
	if r.Bad() {
		return nil, ErrMalformed
	}
	input, ok := Slice(msg, inOff, inLen)
	if !ok {
		return nil, ErrMalformed
	}
	q.Input = input
	return q, nil
}

// QueryDirectoryRequest is the QUERY_DIRECTORY body.
type QueryDirectoryRequest struct {
	Class     uint8
	Flags     uint8
	FileID    FileID
	Pattern   string
	MaxOutput uint32
}

// ParseQueryDirectory reads a QUERY_DIRECTORY request.
func ParseQueryDirectory(msg []byte) (*QueryDirectoryRequest, error) {
	r := body(msg)
	if r.U16() != 33 {
		return nil, ErrMalformed
	}
	q := &QueryDirectoryRequest{Class: r.U8(), Flags: r.U8()}
	r.Skip(4) //File index
	q.FileID = readFileID(r)
	off := int(r.U16())
	n := int(r.U16())
	q.MaxOutput = r.U32()
	if r.Bad() {
		return nil, ErrMalformed
	}
	raw, ok := Slice(msg, off, n)
	if !ok {
		return nil, ErrMalformed
	}
	if q.Pattern, ok = DecodeUTF16(raw); !ok {
		return nil, ErrMalformed
	}
	return q, nil
}

// ChangeNotifyRequest is the CHANGE_NOTIFY body.
type ChangeNotifyRequest struct {
	Flags     uint16
	MaxOutput uint32
	FileID    FileID
	Filter    uint32
}

// ParseChangeNotify reads a CHANGE_NOTIFY request.
func ParseChangeNotify(msg []byte) (*ChangeNotifyRequest, error) {
	r := body(msg)
	if r.U16() != 32 {
		return nil, ErrMalformed
	}
	q := &ChangeNotifyRequest{Flags: r.U16(), MaxOutput: r.U32()}
	q.FileID = readFileID(r)
	q.Filter = r.U32()
	if r.Bad() {
		return nil, ErrMalformed
	}
	return q, nil
}

// QueryInfoRequest is the QUERY_INFO body.
type QueryInfoRequest struct {
	InfoType   uint8
	Class      uint8
	MaxOutput  uint32
	Additional uint32
	FileID     FileID
}

// ParseQueryInfo reads a QUERY_INFO request.
func ParseQueryInfo(msg []byte) (*QueryInfoRequest, error) {
	r := body(msg)
	if r.U16() != 41 {
		return nil, ErrMalformed
	}
	q := &QueryInfoRequest{InfoType: r.U8(), Class: r.U8(), MaxOutput: r.U32()}
	r.Skip(2 + 2 + 4) //Input offset, reserved, input length
	q.Additional = r.U32()
	r.Skip(4) //Flags
	q.FileID = readFileID(r)
	if r.Bad() {
		return nil, ErrMalformed
	}
	return q, nil
}

// SetInfoRequest is the SET_INFO body.
type SetInfoRequest struct {
	InfoType   uint8
	Class      uint8
	Additional uint32
	FileID     FileID
	Data       []byte
}

// ParseSetInfo reads a SET_INFO request.
func ParseSetInfo(msg []byte) (*SetInfoRequest, error) {
	r := body(msg)
	if r.U16() != 33 {
		return nil, ErrMalformed
	}
	q := &SetInfoRequest{InfoType: r.U8(), Class: r.U8()}
	n := int(r.U32())
	off := int(r.U16())
	r.Skip(2)
	q.Additional = r.U32()
	q.FileID = readFileID(r)
	if r.Bad() {
		return nil, ErrMalformed
	}
	data, ok := Slice(msg, off, n)
	if !ok {
		return nil, ErrMalformed
	}
	q.Data = data
	return q, nil
}
