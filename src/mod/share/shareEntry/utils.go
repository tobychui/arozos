package shareEntry

func stringInSlice(e string, s []string) bool {
	for _, a := range s {
		if a == e {
			return true
		}
	}
	return false
}
