package permission

import (
	"testing"
)

func TestGetLargestStorageQuotaFromGroups(t *testing.T) {
	// Test case 1: Empty groups slice
	groups := []*PermissionGroup{}
	result := GetLargestStorageQuotaFromGroups(groups)
	if result != 0 {
		t.Errorf("Test case 1 failed. Expected 0 for empty groups, got %d", result)
	}

	// Test case 2: Single group with non-zero quota
	groups = []*PermissionGroup{
		{
			Name:                "testgroup1",
			DefaultStorageQuota: 1000,
		},
	}
	result = GetLargestStorageQuotaFromGroups(groups)
	if result != 1000 {
		t.Errorf("Test case 2 failed. Expected 1000, got %d", result)
	}

	// Test case 3: Multiple groups, return largest
	groups = []*PermissionGroup{
		{
			Name:                "group1",
			DefaultStorageQuota: 1000,
		},
		{
			Name:                "group2",
			DefaultStorageQuota: 5000,
		},
		{
			Name:                "group3",
			DefaultStorageQuota: 3000,
		},
	}
	result = GetLargestStorageQuotaFromGroups(groups)
	if result != 5000 {
		t.Errorf("Test case 3 failed. Expected 5000, got %d", result)
	}

	// Test case 4: One group has infinite quota (-1)
	groups = []*PermissionGroup{
		{
			Name:                "group1",
			DefaultStorageQuota: 1000,
		},
		{
			Name:                "group2",
			DefaultStorageQuota: -1, // Infinite
		},
		{
			Name:                "group3",
			DefaultStorageQuota: 3000,
		},
	}
	result = GetLargestStorageQuotaFromGroups(groups)
	if result != -1 {
		t.Errorf("Test case 4 failed. Expected -1 for infinite quota, got %d", result)
	}

	// Test case 5: Infinite quota in first position
	groups = []*PermissionGroup{
		{
			Name:                "group1",
			DefaultStorageQuota: -1, // Infinite
		},
		{
			Name:                "group2",
			DefaultStorageQuota: 5000,
		},
	}
	result = GetLargestStorageQuotaFromGroups(groups)
	if result != -1 {
		t.Errorf("Test case 5 failed. Expected -1 for infinite quota in first position, got %d", result)
	}

	// Test case 6: Infinite quota in last position
	groups = []*PermissionGroup{
		{
			Name:                "group1",
			DefaultStorageQuota: 2000,
		},
		{
			Name:                "group2",
			DefaultStorageQuota: 5000,
		},
		{
			Name:                "group3",
			DefaultStorageQuota: -1, // Infinite
		},
	}
	result = GetLargestStorageQuotaFromGroups(groups)
	if result != -1 {
		t.Errorf("Test case 6 failed. Expected -1 for infinite quota in last position, got %d", result)
	}

	// Test case 7: All groups have same quota
	groups = []*PermissionGroup{
		{
			Name:                "group1",
			DefaultStorageQuota: 1000,
		},
		{
			Name:                "group2",
			DefaultStorageQuota: 1000,
		},
		{
			Name:                "group3",
			DefaultStorageQuota: 1000,
		},
	}
	result = GetLargestStorageQuotaFromGroups(groups)
	if result != 1000 {
		t.Errorf("Test case 7 failed. Expected 1000, got %d", result)
	}

	// Test case 8: All groups have zero quota
	groups = []*PermissionGroup{
		{
			Name:                "group1",
			DefaultStorageQuota: 0,
		},
		{
			Name:                "group2",
			DefaultStorageQuota: 0,
		},
	}
	result = GetLargestStorageQuotaFromGroups(groups)
	if result != 0 {
		t.Errorf("Test case 8 failed. Expected 0, got %d", result)
	}

	// Test case 9: Mix of zero and positive quotas
	groups = []*PermissionGroup{
		{
			Name:                "group1",
			DefaultStorageQuota: 0,
		},
		{
			Name:                "group2",
			DefaultStorageQuota: 1000,
		},
		{
			Name:                "group3",
			DefaultStorageQuota: 0,
		},
	}
	result = GetLargestStorageQuotaFromGroups(groups)
	if result != 1000 {
		t.Errorf("Test case 9 failed. Expected 1000, got %d", result)
	}

	// Test case 10: Very large quota values
	groups = []*PermissionGroup{
		{
			Name:                "group1",
			DefaultStorageQuota: 1099511627776, // 1TB in bytes
		},
		{
			Name:                "group2",
			DefaultStorageQuota: 10995116277760, // 10TB in bytes
		},
	}
	result = GetLargestStorageQuotaFromGroups(groups)
	if result != 10995116277760 {
		t.Errorf("Test case 10 failed. Expected 10995116277760, got %d", result)
	}

	// Test case 11: Multiple infinite quotas
	groups = []*PermissionGroup{
		{
			Name:                "group1",
			DefaultStorageQuota: -1,
		},
		{
			Name:                "group2",
			DefaultStorageQuota: -1,
		},
		{
			Name:                "group3",
			DefaultStorageQuota: -1,
		},
	}
	result = GetLargestStorageQuotaFromGroups(groups)
	if result != -1 {
		t.Errorf("Test case 11 failed. Expected -1 for multiple infinite quotas, got %d", result)
	}

	// Test case 12: Single group with zero quota
	groups = []*PermissionGroup{
		{
			Name:                "group1",
			DefaultStorageQuota: 0,
		},
	}
	result = GetLargestStorageQuotaFromGroups(groups)
	if result != 0 {
		t.Errorf("Test case 12 failed. Expected 0, got %d", result)
	}

	// Test case 13: Single group with infinite quota
	groups = []*PermissionGroup{
		{
			Name:                "admin",
			DefaultStorageQuota: -1,
		},
	}
	result = GetLargestStorageQuotaFromGroups(groups)
	if result != -1 {
		t.Errorf("Test case 13 failed. Expected -1, got %d", result)
	}

	// Test case 14: Descending order quotas
	groups = []*PermissionGroup{
		{
			Name:                "group1",
			DefaultStorageQuota: 5000,
		},
		{
			Name:                "group2",
			DefaultStorageQuota: 3000,
		},
		{
			Name:                "group3",
			DefaultStorageQuota: 1000,
		},
	}
	result = GetLargestStorageQuotaFromGroups(groups)
	if result != 5000 {
		t.Errorf("Test case 14 failed. Expected 5000, got %d", result)
	}

	// Test case 15: Ascending order quotas
	groups = []*PermissionGroup{
		{
			Name:                "group1",
			DefaultStorageQuota: 1000,
		},
		{
			Name:                "group2",
			DefaultStorageQuota: 3000,
		},
		{
			Name:                "group3",
			DefaultStorageQuota: 5000,
		},
	}
	result = GetLargestStorageQuotaFromGroups(groups)
	if result != 5000 {
		t.Errorf("Test case 15 failed. Expected 5000, got %d", result)
	}
}
