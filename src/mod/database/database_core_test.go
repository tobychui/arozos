package database

import (
	"fmt"
	"math/rand"
	"os"
	"testing"
)

var dbFilePath = "../../test/"
var dbFileName = "testdb.db"
var db *Database

func setupSuite(t *testing.T) func(t *testing.T) {
	//t.Log("Setting up database env")

	os.Mkdir(dbFilePath, 0777)
	file, err := os.Create(dbFilePath + dbFileName)
	if err != nil {
		t.Fatalf("Failed to create file: %v", err)
	}
	file.Close()

	// Return a function to teardown the test
	return func(t *testing.T) {
		//t.Log("Cleaning up")
		err := os.RemoveAll(dbFilePath)
		if err != nil {
			t.Fatalf("Failed to clean up: %v", err)
		}
	}
}

func TestDatabaseSimple(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	// Create a new database
	var err error
	db, err = newDatabase(dbFilePath+dbFileName, false)
	if err != nil {
		t.Fatalf("Failed to create a new database: %v", err)
	}

	tableName := "testTable"
	key := "testKey"
	value := map[string]interface{}{"field1": "value1", "field2": "value2"}

	// Test creating a new table
	err = db.newTable(tableName)
	if err != nil {
		t.Fatalf("Failed to create a new table: %v", err)
	}

	// Test writing data to the table
	err = db.write(tableName, key, value)
	if err != nil {
		t.Fatalf("Failed to write data to the table: %v", err)
	}

	// Test reading data from the table
	var result map[string]interface{}
	err = db.read(tableName, key, &result)
	if err != nil {
		t.Fatalf("Failed to read data from the table: %v", err)
	}

	// Verify the read data
	if result["field1"] != "value1" || result["field2"] != "value2" {
		t.Fatalf("Read data does not match the expected value")
	}

	// Test dropping the table
	err = db.dropTable(tableName)
	if err != nil {
		t.Fatalf("Failed to drop the table: %v", err)
	}

	// Verify that the table no longer exists
	if db.tableExists(tableName) {
		t.Fatalf("Table still exists after dropping")
	}

	defer db.close()
}

func TestDatabaseComplexRW(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	// Create a new database
	var err error
	db, err = newDatabase(dbFilePath+dbFileName, false)
	if err != nil {
		t.Fatalf("Failed to create a new database: %v", err)
	}

	tableName := "testTable"
	// Test creating a new table
	err = db.newTable(tableName)
	if err != nil {
		t.Fatalf("Failed to create a new table: %v", err)
	}

	numRequests := 1000

	// Perform multiple write requests with random keys and values
	mp := make(map[string]map[string]interface{}, 1000)
	for i := 0; i < numRequests; i++ {
		key := "Pkey_" + fmt.Sprint(rand.Intn(1000))
		value := map[string]interface{}{"Skey_" + fmt.Sprint(rand.Intn(1000)): "value_" + fmt.Sprint(rand.Intn(1000))}

		mp[key] = value

		err := db.write("testTable", key, value)
		if err != nil {
			t.Fatalf("Failed to write data to the table: %v", err)
		}
	}

	for k, v := range mp {
		var result map[string]interface{}
		err := db.read("testTable", k, &result)
		if err != nil {
			t.Fatalf("Failed to read data from the table: %v", err)
		}
		if fmt.Sprintf("%v", result) != fmt.Sprintf("%v", v) {
			t.Fatalf("Data mismatch: expected %v, got %v", v, result)
		}
	}

	defer db.close()
}
