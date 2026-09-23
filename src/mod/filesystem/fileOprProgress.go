package filesystem

/*
	File Operation Progress Reporting
	author: tobychui

	Byte level progress reporting for the file operation wrappers in fileOpr.go.

	A file operation used to report its progress once per file, which made the
	bar useless for the two cases that matter most: a list of files with wildly
	different sizes, and a single large file that would sit unchanged for
	minutes before jumping straight to done. The helpers here count the bytes as
	they stream through, so the progress of an operation always reflects how much
	of it is actually finished.
*/

import (
	"errors"
	"io"
	"time"
)

const (
	//How often a running file operation reports its position upwards. A byte
	//counting reader sees every buffer that goes past, which on a local disk is
	//thousands of reads a second, so the reports are rate limited from here.
	fileOprProgressInterval = 200 * time.Millisecond

	//How long a paused file operation waits before asking for the signal again
	fileOprPauseCheckInterval = 500 * time.Millisecond
)

/*
FileOperationProgressHandler is called while a file operation is running.

currentFile is the file being processed at this moment, bytesDone and bytesTotal
describe the progress of the whole operation in bytes, where bytesTotal is 0 when
the size could not be resolved beforehand. The handler returns one of the
FsOpr_* control signals.
*/
type FileOperationProgressHandler func(currentFile string, bytesDone int64, bytesTotal int64) int

// progressReporter rate limits the progress callbacks of a file operation and
// applies the pause and cancel signals the handler returns.
type progressReporter struct {
	handler     FileOperationProgressHandler
	totalBytes  int64  //Total size of this file operation in bytes
	currentFile string //File being processed right now
	cancelled   bool   //Whether the user asked to stop this operation
	lastReport  time.Time
}

func newProgressReporter(handler FileOperationProgressHandler, totalBytes int64) *progressReporter {
	return &progressReporter{
		handler:    handler,
		totalBytes: totalBytes,
	}
}

/*
report pushes the current position upwards, waits out a pause and returns an
error once the user cancels the operation.

Set force for the positions that must not be dropped, like the start and the end
of a file. Everything else is subject to the fileOprProgressInterval rate limit.
*/
func (p *progressReporter) report(bytesDone int64, force bool) error {
	if p == nil || p.handler == nil {
		return nil
	}
	if p.cancelled {
		return errors.New("Operation cancelled by user")
	}
	if !force && time.Since(p.lastReport) < fileOprProgressInterval {
		return nil
	}

	signal := p.handler(p.currentFile, bytesDone, p.totalBytes)
	for signal == FsOpr_Pause {
		//Hold the transfer here until the operation is resumed or cancelled
		time.Sleep(fileOprPauseCheckInterval)
		signal = p.handler(p.currentFile, bytesDone, p.totalBytes)
	}

	//A pause may have held this call for a long time, restart the rate limit
	//window from the moment the handler actually returned
	p.lastReport = time.Now()

	if signal == FsOpr_Cancel {
		p.cancelled = true
		return errors.New("Operation cancelled by user")
	}
	return nil
}

// progressReader counts the bytes that stream through it and reports them
// upwards. A cancelled operation surfaces as a read error, which aborts the
// copy where it stands.
type progressReader struct {
	reader   io.Reader
	reporter *progressReporter
	baseDone int64 //Bytes of this operation already done before this stream
	streamed int64 //Bytes that went through this reader so far
}

// newProgressReader wraps a reader so the bytes going through it are reported.
// baseDone is how much of the operation was already done when the stream began.
// The reader is handed back untouched when there is nothing to report to.
func newProgressReader(reader io.Reader, reporter *progressReporter, baseDone int64) io.Reader {
	if reporter == nil || reporter.handler == nil {
		return reader
	}
	return &progressReader{
		reader:   reader,
		reporter: reporter,
		baseDone: baseDone,
	}
}

func (p *progressReader) Read(buf []byte) (int, error) {
	n, err := p.reader.Read(buf)
	if n > 0 {
		p.streamed += int64(n)
		if reportErr := p.reporter.report(p.baseDone+p.streamed, false); reportErr != nil {
			//Stop the transfer, the bytes read so far are still handed over so
			//the writer can finish the buffer it is holding
			return n, reportErr
		}
	}
	return n, err
}

// legacyProgressAdapter turns a byte level progress handler back into the
// percentage based callback that the original FileCopy and FileMove take.
func legacyProgressAdapter(progressUpdate func(int, string) int) FileOperationProgressHandler {
	if progressUpdate == nil {
		return nil
	}

	return func(currentFile string, bytesDone int64, bytesTotal int64) int {
		progress := 0
		if bytesTotal > 0 {
			progress = int(float64(bytesDone) / float64(bytesTotal) * 100)
		}
		if progress > 100 {
			progress = 100
		}
		return progressUpdate(progress, currentFile)
	}
}
