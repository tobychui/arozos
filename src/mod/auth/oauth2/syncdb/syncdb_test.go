package syncdb

import (
	"testing"
)

func TestSyncDB_Store(t *testing.T) {
	syncDB := NewSyncDB()

	// Store a value in the SyncDB
	uuid := syncDB.Store("TestValue")

	// Read the value from the SyncDB
	result := syncDB.Read(uuid)

	// Verify that the value is stored and retrieved correctly
	if result != "TestValue" {
		t.Errorf("Expected 'TestValue', got %s", result)
	}
}

func TestSyncDB_Read(t *testing.T) {
	syncDB := NewSyncDB()

	// Store a value in the SyncDB
	uuid := syncDB.Store("TestValue")

	// Read the value from the SyncDB
	result := syncDB.Read(uuid)

	// Verify that the value is stored and retrieved correctly
	if result != "TestValue" {
		t.Errorf("Expected 'TestValue', got %s", result)
	}

	// Try to read a non-existent UUID
	nonExistentResult := syncDB.Read("NonExistentUUID")

	// Verify that the result is empty for non-existent UUID
	if nonExistentResult != "" {
		t.Errorf("Expected empty result for non-existent UUID, got %s", nonExistentResult)
	}
}

func TestSyncDB_Delete(t *testing.T) {
	syncDB := NewSyncDB()

	// Store a value in the SyncDB
	uuid := syncDB.Store("TestValue")

	// Delete the stored value
	syncDB.Delete(uuid)

	// Try to read the deleted value
	deletedResult := syncDB.Read(uuid)

	// Verify that the result is empty for the deleted UUID
	if deletedResult != "" {
		t.Errorf("Expected empty result for deleted UUID, got %s", deletedResult)
	}
}

/*
func TestSyncDB_AutoCleaning(t *testing.T) {
	syncDB := NewSyncDB()

	// Store a value in the SyncDB
	uuid := syncDB.Store("TestValue")

	// Wait for auto-cleaning routine to run
	time.Sleep(6 * time.Minute)

	// Try to read the cleaned value
	cleanedResult := syncDB.Read(uuid)

	// Verify that the result is empty for the cleaned UUID
	if cleanedResult != "" {
		t.Errorf("Expected empty result for cleaned UUID, got %s", cleanedResult)
	}
}
*/

func TestSyncDB_ToString(t *testing.T) {
	syncDB := NewSyncDB()

	// Store some values in the SyncDB
	syncDB.Store("Value1")
	syncDB.Store("Value2")

	// Display the contents of the SyncDB
	syncDB.ToString()

	// Verify that the values are displayed correctly
	// This should be manually inspected as it prints to stdout
}
