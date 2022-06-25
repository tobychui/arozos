package hybridBackup

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"imuslab.com/arozos/mod/database"
)

/*
	Hybrid Backup

	This module handle backup functions from the drive with Hieracchy labeled as "backup"
	Backup modes suport in this module currently consists of

	Denote P drive as parent drive and B drive as backup drive.
	1. Basic (basic):
		- Any new file created in P will be copied to B within 1 minutes
		- Any file change will be copied to B within 30 minutes
		- Any file removed in P will be delete from backup if it is > 24 hours old
	2. Nightly (nightly):
		- The whole P drive will be copied to N drive every night
	3. Versioning (version)
		- A versioning system will be introduce to this backup drive
		- Just like the time machine

	Tips when developing this module
	- This is a sub-module of the current file system. Do not import from arozos file system module
	- If you need any function from the file system, copy and paste it in this module
*/

type Manager struct {
	Ticker     *time.Ticker  `json:"-"` //The main ticker
	StopTicker chan bool     `json:"-"` //Channel for stopping the backup
	Tasks      []*BackupTask //The backup tasks that is running under this manager
}

type BackupTask struct {
	JobName           string             //The name used by the scheduler for executing this config
	CycleCounter      int64              //The number of backup executed in the background
	LastCycleTime     int64              //The execution time of the last cycle
	Enabled           bool               //Check if the task is enabled. Will not execute if this is set to false
	DiskUID           string             //The UID of the target fsandlr
	DiskPath          string             //The mount point for the disk
	ParentUID         string             //Parent virtal disk UUID
	ParentPath        string             //Parent disk path
	DeleteFileMarkers map[string]int64   //Markers for those files delete pending, [file path (relative)] time
	Database          *database.Database //The database for storing requried data
	Mode              string             //Backup mode
	PanicStopped      bool               //If the backup process has been stopped due to panic situationc
	ErrorMessage      string             //Panic stop message
}

//A snapshot summary
type SnapshotSummary struct {
	ChangedFiles   map[string]string
	UnchangedFiles map[string]string
	DeletedFiles   map[string]string
}

//A file in the backup drive that is restorable
type RestorableFile struct {
	Filename      string //Filename of this restorable object
	IsHidden      bool   //Check if the file is hidden or located in a path within hidden folder
	Filesize      int64  //The file size to be restorable
	RelpathOnDisk string //Relative path of this file to the root
	RestorePoint  string //The location this file should restore to
	BackupDiskUID string //The UID of disk that is hold the backup of this file
	RemainingTime int64  //Remaining time till auto remove
	DeleteTime    int64  //Delete time
	IsSnapshot    bool   //Define is this restorable file point to a snapshot instead
}

//The restorable report
type RestorableReport struct {
	ParentUID       string            //The Disk ID to be restored to
	RestorableFiles []*RestorableFile //A list of restorable files
}

var (
	internalTickerTime time.Duration = 60
)

func NewHyperBackupManager() *Manager {
	//Create a new minute ticker
	ticker := time.NewTicker(internalTickerTime * time.Second)
	stopper := make(chan bool, 1)

	newManager := &Manager{
		Ticker:     ticker,
		StopTicker: stopper,
		Tasks:      []*BackupTask{},
	}

	///Create task executor
	go func() {
		defer log.Println("HybridBackup stopped")
		for {
			select {
			case <-ticker.C:
				for _, task := range newManager.Tasks {
					if task.Enabled == true {
						output, err := task.HandleBackupProcess()
						if err != nil {
							task.Enabled = false
							task.PanicStopped = true
							task.ErrorMessage = output
						}
					}
				}
			case <-stopper:
				return
			}
		}
	}()

	//Return the manager
	return newManager
}

func (m *Manager) AddTask(newtask *BackupTask) error {
	//Create a job for this
	newtask.JobName = "backup-" + newtask.DiskUID + ""

	//Check if the same job name exists
	for _, task := range m.Tasks {
		if task.JobName == newtask.JobName {
			return errors.New("Task already exists")
		}
	}

	//Create / Load a backup database for the task
	dbPath := filepath.Join(newtask.DiskPath, newtask.JobName+".db")
	thisdb, err := database.NewDatabase(dbPath, false)
	if err != nil {
		log.Println("[HybridBackup] Failed to create database for backup tasks. Running without one.")
	} else {
		newtask.Database = thisdb
		thisdb.NewTable("DeleteMarkers")
	}

	if newtask.Mode == "basic" || newtask.Mode == "nightly" {
		//Load the delete marker from the database if exists
		if thisdb.TableExists("DeleteMarkers") {
			//Table exists. Read all its content to delete markers
			entries, _ := thisdb.ListTable("DeleteMarkers")
			for _, keypairs := range entries {
				relPath := string(keypairs[0])
				delTime := int64(0)
				json.Unmarshal(keypairs[1], &delTime)

				//Add this to delete marker
				newtask.DeleteFileMarkers[relPath] = delTime
			}
		}
	}

	//Add task to list
	m.Tasks = append(m.Tasks, newtask)

	//Start the task
	m.StartTask(newtask.JobName)

	//log.Println(">>>> [Debug] New Backup Tasks added: ", newtask.JobName, newtask)

	return nil
}

//Start a given task given name
func (m *Manager) StartTask(jobname string) {
	for _, task := range m.Tasks {
		if task.JobName == jobname {
			//Enable to job
			task.Enabled = true

			//Run it once in go routine
			go func() {
				output, err := task.HandleBackupProcess()
				if err != nil {
					task.Enabled = false
					task.PanicStopped = true
					task.ErrorMessage = output
				}
			}()

		}
	}
}

//Stop a given task given its job name
func (m *Manager) StopTask(jobname string) {
	for _, task := range m.Tasks {
		if task.JobName == jobname {
			task.Enabled = false
		}
	}
}

//Stop all managed handlers
func (m *Manager) Close() error {
	//Stop the schedule
	if m != nil {
		m.StopTicker <- true

		//Close all database opened by backup task
		for _, task := range m.Tasks {
			task.Database.Close()
		}
	}

	return nil
}

//Main handler function for hybrid backup
func (backupConfig *BackupTask) HandleBackupProcess() (string, error) {
	//Check if the target disk is writable and mounted
	if fileExists(filepath.Join(backupConfig.ParentPath, "aofs.db")) {
		//This parent filesystem is mounted

	} else {
		//Parent File system not mounted.Terminate backup scheduler
		log.Println("[HybridBackup] Skipping backup cycle for " + backupConfig.ParentUID + ":/, Parent drive not mounted")
		return "Parent drive (" + backupConfig.ParentUID + ":/) not mounted", nil
	}

	//Check if the backup disk is mounted. If no, stop the scheulder
	if backupConfig.CycleCounter > 3 && !(fileExists(filepath.Join(backupConfig.DiskPath, "aofs.db")) && fileExists(filepath.Join(backupConfig.DiskPath, "aofs.db.lock"))) {
		log.Println("[HybridBackup] Backup schedule stopped for " + backupConfig.DiskUID + ":/")
		return "Backup drive (" + backupConfig.DiskUID + ":/) not mounted", errors.New("Backup File System Handler not mounted")
	}

	deepBackup := true //Default perform deep backup
	if backupConfig.Mode == "basic" {
		if backupConfig.CycleCounter%3 == 0 {
			//Perform deep backup, use walk function
			deepBackup = true
			log.Println("[HybridBackup] Basic backup executed: " + backupConfig.ParentUID + ":/ -> " + backupConfig.DiskUID + ":/")
			backupConfig.LastCycleTime = time.Now().Unix()
		} else {
			deepBackup = false
		}

		//Add one to the cycle counter
		backupConfig.CycleCounter++
		_, err := executeBackup(backupConfig, deepBackup)
		if err != nil {
			log.Println("[HybridBackup] Backup failed: " + err.Error())
		}
	} else if backupConfig.Mode == "nightly" {
		if time.Now().Unix()-backupConfig.LastCycleTime >= 86400 {
			//24 hours from last backup. Execute deep backup now
			backupConfig.LastCycleTime = time.Now().Unix()
			executeBackup(backupConfig, true)
			log.Println("[HybridBackup] Executing nightly backup: " + backupConfig.ParentUID + ":/ -> " + backupConfig.DiskUID + ":/")

			//Add one to the cycle counter
			backupConfig.CycleCounter++
		}

	} else if backupConfig.Mode == "version" {
		//Do a versioning backup every 6 hours
		if time.Now().Unix()-backupConfig.LastCycleTime >= 21600 {
			//Scheduled backup or initial backup
			backupConfig.LastCycleTime = time.Now().Unix()
			executeVersionBackup(backupConfig)
			log.Println("[HybridBackup] Executing backup schedule: " + backupConfig.ParentUID + ":/ -> " + backupConfig.DiskUID + ":/")

			//Add one to the cycle counter
			backupConfig.CycleCounter++
		}
	}

	//Return the log information
	return "", nil
}

//Get the restore parent disk ID by backup disk ID
func (m *Manager) GetParentDiskIDByRestoreDiskID(restoreDiskID string) (string, error) {
	backupTask := m.getTaskByBackupDiskID(restoreDiskID)
	if backupTask == nil {
		return "", errors.New("This disk do not have a backup task in this backup maanger")
	}

	return backupTask.ParentUID, nil
}

//Restore accidentailly removed file from backup
func (m *Manager) HandleRestore(restoreDiskID string, targetFileRelpath string, username *string) error {
	//Get the backup task from backup disk id
	backupTask := m.getTaskByBackupDiskID(restoreDiskID)
	if backupTask == nil {
		return errors.New("Target disk is not a backup disk")
	}

	//Check if source exists and target not exists
	//log.Println("[debug]", backupTask)

	restoreSource := filepath.Join(backupTask.DiskPath, targetFileRelpath)
	if backupTask.Mode == "basic" || backupTask.Mode == "nightly" {
		restoreSource = filepath.Join(backupTask.DiskPath, "/backup/", targetFileRelpath)
		restoreTarget := filepath.Join(backupTask.ParentPath, targetFileRelpath)

		if !fileExists(restoreSource) {
			//Restore source not exists
			return errors.New("Restore source file not exists")
		}

		if fileExists(restoreTarget) {
			//Restore target already exists.
			return errors.New("Restore target already exists. Cannot overwrite.")
		}

		//Check if the restore target parent folder exists. If not, create it
		if !fileExists(filepath.Dir(restoreTarget)) {
			os.MkdirAll(filepath.Dir(restoreTarget), 0755)
		}

		//Ready to move it back
		err := BufferedLargeFileCopy(restoreSource, restoreTarget, 4086)
		if err != nil {
			return errors.New("Restore failed: " + err.Error())
		}
	} else if backupTask.Mode == "version" {
		//Check if username is set
		if username == nil {
			return errors.New("Snapshot mode backup require username to restore")
		}

		//Restore the snapshot
		err := restoreSnapshotByName(backupTask, targetFileRelpath, username)
		if err != nil {
			return errors.New("Restore failed: " + err.Error())
		}
	}

	//Restore completed
	return nil
}

//List the file that is restorable from the given disk
func (m *Manager) ListRestorable(parentDiskID string) (RestorableReport, error) {
	//List all the backup process that is mirroring this parent disk
	tasks := m.getTaskByParentDiskID(parentDiskID)
	if len(tasks) == 0 {
		return RestorableReport{}, errors.New("No backup root found for this " + parentDiskID + ":/ virtual root.")
	}

	diffFiles := []*RestorableFile{}

	//Extract all comparasion
	for _, task := range tasks {
		if task.Mode == "basic" || task.Mode == "nightly" {
			restorableFiles, err := listBasicRestorables(task)
			if err != nil {
				//Something went wrong. Skip this
				continue
			}
			for _, restorable := range restorableFiles {
				diffFiles = append(diffFiles, restorable)
			}
		} else if task.Mode == "version" {
			restorableFiles, err := listVersionRestorables(task)
			if err != nil {
				//Something went wrong. Skip this
				continue
			}
			for _, restorable := range restorableFiles {
				diffFiles = append(diffFiles, restorable)
			}

		} else {
			//Unknown mode. Skip it

		}

	}

	//Create a Restorable Report
	thisReport := RestorableReport{
		ParentUID:       parentDiskID,
		RestorableFiles: diffFiles,
	}

	return thisReport, nil
}

//Get tasks from parent disk id, might return multiple task or no tasks
func (m *Manager) getTaskByParentDiskID(parentDiskID string) []*BackupTask {
	//Convert ID:/ format to ID
	if strings.Contains(parentDiskID, ":") {
		parentDiskID = strings.Split(parentDiskID, ":")[0]
	}

	possibleTask := []*BackupTask{}
	for _, task := range m.Tasks {
		if task.ParentUID == parentDiskID {
			//This task parent is the target disk. push this to list
			possibleTask = append(possibleTask, task)
		}
	}
	return possibleTask
}

//Get task by backup Disk ID, only return 1 task
func (m *Manager) getTaskByBackupDiskID(backupDiskID string) *BackupTask {
	//Trim the :/ parts
	if strings.Contains(backupDiskID, ":") {
		backupDiskID = strings.Split(backupDiskID, ":")[0]
	}

	for _, task := range m.Tasks {
		if task.DiskUID == backupDiskID {
			return task
		}
	}

	return nil
}

//Get and return the file hash for a file
func getFileHash(filename string) (string, error) {
	f, err := os.Open(filename)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}

	return hex.EncodeToString(h.Sum(nil)), nil
}

func (m *Manager) GetTaskByBackupDiskID(backupDiskID string) (*BackupTask, error) {
	targetTask := m.getTaskByBackupDiskID(backupDiskID)
	if targetTask == nil {
		return nil, errors.New("Task not found")
	}
	return targetTask, nil
}
