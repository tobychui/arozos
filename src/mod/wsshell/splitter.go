package wsshell

import "strings"

func customSplitter(data []byte, atEOF bool) (advance int, token []byte, err error) {
	// Return nothing if at end of file and no data passed
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}

	i := strings.Index(string(data), "\n")
	j := strings.Index(string(data), "\r")
	if i >= 0 {
		return i + 1, data[0:i], nil
	} else if j >= 0 {
		return j + 1, data[0:j], nil
	}

	// If at end of file with data return the data
	if atEOF {
		return len(data), data, nil
	}

	return
}
