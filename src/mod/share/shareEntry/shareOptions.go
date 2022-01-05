package shareEntry

func (s *ShareOption) IsOwnedBy(username string) bool {
	return s.Owner == username
}

func (s *ShareOption) IsAccessibleBy(username string, usergroup []string) bool {
	if s.Permission == "anyone" || s.Permission == "signedin" {
		return true
	} else if s.Permission == "samegroup" || s.Permission == "groups" {
		for _, thisUserGroup := range usergroup {
			if stringInSlice(thisUserGroup, s.Accessibles) {
				//User's group is in the allowed group
				return true
			}
		}
	} else if s.Permission == "users" {
		if stringInSlice(username, s.Accessibles) {
			//User's name is in the allowed group
			return true
		}
	}
	return false
}
