package permission

//Get the largest storage quota from all the given groups. Return int64
func GetLargestStorageQuotaFromGroups(groups []*PermissionGroup) int64 {
	maxQuota := int64(0)
	for _, group := range groups {
		if group.DefaultStorageQuota > maxQuota {
			maxQuota = group.DefaultStorageQuota
		} else if group.DefaultStorageQuota == -1 {
			//Inifnite. Max quota reached
			return -1
		}
	}

	return maxQuota
}
