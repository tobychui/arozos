package syncdb

import (
	"fmt"
	"sync"
	"time"

	uuid "github.com/satori/go.uuid"
)

type SyncDB struct {
	db *sync.Map //HERE ALSO CHANGED, USE POINTER INSTEAD OF A COPY OF THE ORIGINAL SYNCNAMP
}

type dbStructure struct {
	timestamp time.Time
	value     string
}

func NewSyncDB() *SyncDB {
	//Create a new SyncMap for this SyncDB Object
	newDB := sync.Map{}
	//Put the newly craeted syncmap into the db object
	newSyncDB := SyncDB{db: &newDB} //!!! USE POINTER HERE INSTEAD OF THE SYNC MAP ITSELF
	//Return the pointer of the new SyncDB object
	newSyncDB.AutoCleaning()
	return &newSyncDB
}

func (p SyncDB) AutoCleaning() {
	//create the routine for auto clean trash
	go func() {
		for {
			<-time.After(5 * 60 * time.Second) //no rush, clean every five minute
			p.db.Range(func(key, value interface{}) bool {
				if time.Now().Sub(value.(dbStructure).timestamp).Minutes() >= 30 {
					p.db.Delete(key)
				}
				return true
			})
		}
	}()
}

func (p SyncDB) Store(value string) string {
	uid := uuid.NewV4().String()
	NewField := dbStructure{
		timestamp: time.Now(),
		value:     value,
	}
	p.db.Store(uid, NewField)
	return uid
}

func (p SyncDB) Read(uuid string) string {
	value, ok := p.db.Load(uuid)
	if !ok {
		return ""
	} else {
		return value.(dbStructure).value
	}
}

func (p SyncDB) Delete(uuid string) {
	p.db.Delete(uuid)
}

func (p SyncDB) ToString() {
	p.db.Range(func(key, value interface{}) bool {
		fmt.Print(key)
		fmt.Print(" : ")
		fmt.Println(value.(dbStructure).value)
		fmt.Print(" @ ")
		//fmt.Print(value.(dbStructure).timestamp)
		fmt.Print(time.Now().Sub(value.(dbStructure).timestamp).Seconds())
		fmt.Print("\n")
		return true
	})
}
