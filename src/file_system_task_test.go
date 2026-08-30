package main

import (
	"strconv"
	"testing"
	"time"

	"imuslab.com/arozos/mod/filesystem"
)

// newTestFileOperationTask registers a task record for testing and returns it
func newTestFileOperationTask(t *testing.T, id string, sizes []int64) *fileOperationTask {
	t.Helper()
	subtasks := []*fileOperationSubtask{}
	totalSize := int64(0)
	for _, size := range sizes {
		totalSize += size
		subtasks = append(subtasks, &fileOperationSubtask{
			Filename: "testfile",
			Src:      "user:/testfile",
			Size:     size,
			Status:   FsTask_Pending,
		})
	}

	thisTask := &fileOperationTask{
		ID:                  id,
		Owner:               "test_user",
		Operation:           "copy",
		Src:                 "user:/",
		Dest:                "user:/Desktop/",
		FileOperationSignal: filesystem.FsOpr_Continue,
		Files:               subtasks,
		TotalSize:           totalSize,
		Status:              FsTask_Ongoing,
	}

	wsConnectionStore.Store(id, thisTask)
	t.Cleanup(func() {
		wsConnectionStore.Delete(id)
	})
	return thisTask
}

func TestTaskIsFinished(t *testing.T) {
	tests := []struct {
		name   string
		status string
		want   bool
	}{
		{"pending task is not finished", FsTask_Pending, false},
		{"ongoing task is not finished", FsTask_Ongoing, false},
		{"completed task is finished", FsTask_Completed, true},
		{"errored task is finished", FsTask_Error, true},
		{"cancelled task is finished", FsTask_Cancelled, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := taskIsFinished(&fileOperationTask{Status: tt.status})
			if got != tt.want {
				t.Errorf("taskIsFinished(%s) = %v, want %v", tt.status, got, tt.want)
			}
		})
	}
}

func TestSumFileOperationDoneSize(t *testing.T) {
	tests := []struct {
		name string
		done []int64
		want int64
	}{
		{"no file", []int64{}, 0},
		{"single file", []int64{1024}, 1024},
		{"multiple files", []int64{100, 250, 650}, 1000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			thisTask := &fileOperationTask{}
			for _, done := range tt.done {
				thisTask.Files = append(thisTask.Files, &fileOperationSubtask{Done: done})
			}
			if got := sumFileOperationDoneSize(thisTask); got != tt.want {
				t.Errorf("sumFileOperationDoneSize() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestUpdateOngoingFileOperationSubtask(t *testing.T) {
	thisTask := newTestFileOperationTask(t, "test_opr_subtask", []int64{1000, 1000})

	sig, progress, err := UpdateOngoingFileOperationSubtask(thisTask.ID, 0, "testfile", 500, 1000)
	if err != nil {
		t.Fatalf("UpdateOngoingFileOperationSubtask() returned error: %v", err)
	}
	if sig != filesystem.FsOpr_Continue {
		t.Errorf("signal = %d, want %d", sig, filesystem.FsOpr_Continue)
	}
	if thisTask.Files[0].Done != 500 {
		t.Errorf("subtask done size = %d, want 500", thisTask.Files[0].Done)
	}
	if thisTask.DoneSize != 500 {
		t.Errorf("task done size = %d, want 500", thisTask.DoneSize)
	}
	//500 of the 2000 bytes in this operation are done
	if progress != 25 || thisTask.Progress != 25 {
		t.Errorf("task progress = %v (returned %v), want 25", thisTask.Progress, progress)
	}

	//A size the file operation reports overrides the one resolved at task creation
	if _, _, err := UpdateOngoingFileOperationSubtask(thisTask.ID, 1, "testfile", 250, 3000); err != nil {
		t.Fatalf("UpdateOngoingFileOperationSubtask() returned error: %v", err)
	}
	if thisTask.Files[1].Size != 3000 {
		t.Errorf("subtask size = %d, want 3000", thisTask.Files[1].Size)
	}
	if thisTask.TotalSize != 4000 {
		t.Errorf("task total size = %d, want 4000", thisTask.TotalSize)
	}

	//Bytes beyond the size of a file are clamped rather than trusted
	if _, _, err := UpdateOngoingFileOperationSubtask(thisTask.ID, 0, "testfile", 999999, 0); err != nil {
		t.Fatalf("UpdateOngoingFileOperationSubtask() returned error: %v", err)
	}
	if thisTask.Files[0].Done != 1000 {
		t.Errorf("subtask done size = %d, want it clamped to 1000", thisTask.Files[0].Done)
	}

	//Out of range subtask index should not panic nor change the per file records
	if _, _, err := UpdateOngoingFileOperationSubtask(thisTask.ID, 9, "testfile", 100, 100); err != nil {
		t.Fatalf("UpdateOngoingFileOperationSubtask() with out of range index returned error: %v", err)
	}

	//Unknown operation id must return an error
	if _, _, err := UpdateOngoingFileOperationSubtask("no_such_opr", 0, "testfile", 10, 10); err == nil {
		t.Error("UpdateOngoingFileOperationSubtask() with unknown oprid should return an error")
	}
}

// A small file next to a large one must not count for the same share of the bar
func TestRecalculateFileOperationProgressIsSizeWeighted(t *testing.T) {
	//One 1 KB file and one 4 GB file
	small := int64(1024)
	large := int64(4 * 1024 * 1024 * 1024)
	thisTask := newTestFileOperationTask(t, "test_opr_weighted", []int64{small, large})

	//The small file is done, the large one has not started
	MarkFileOperationSubtaskEnded(thisTask.ID, 0, "")

	if thisTask.Progress > 1 {
		t.Errorf("progress = %v after the small file finished, want it near 0", thisTask.Progress)
	}

	//Half of the large file is through
	if _, _, err := UpdateOngoingFileOperationSubtask(thisTask.ID, 1, "big", large/2, large); err != nil {
		t.Fatalf("UpdateOngoingFileOperationSubtask() returned error: %v", err)
	}
	if thisTask.Progress < 49 || thisTask.Progress > 51 {
		t.Errorf("progress = %v with half the large file done, want about 50", thisTask.Progress)
	}
}

// Operations whose file sizes could not be resolved still report something sane
func TestRecalculateFileOperationProgressWithoutSizes(t *testing.T) {
	thisTask := newTestFileOperationTask(t, "test_opr_nosize", []int64{0, 0})

	thisTask.Files[0].Progress = 100
	thisTask.Files[1].Progress = 0
	recalculateFileOperationProgress(thisTask)

	if thisTask.Progress != 50 {
		t.Errorf("progress = %v, want 50 when falling back to equal weighting", thisTask.Progress)
	}
}

func TestMarkFileOperationSubtaskEnded(t *testing.T) {
	thisTask := newTestFileOperationTask(t, "test_opr_subtask_end", []int64{800, 200})

	MarkFileOperationSubtaskEnded(thisTask.ID, 0, "")
	if thisTask.Files[0].Status != FsTask_Completed {
		t.Errorf("subtask status = %s, want %s", thisTask.Files[0].Status, FsTask_Completed)
	}
	if thisTask.Files[0].Done != 800 || thisTask.DoneSize != 800 {
		t.Errorf("done size = %d / %d, want 800 / 800", thisTask.Files[0].Done, thisTask.DoneSize)
	}

	MarkFileOperationSubtaskEnded(thisTask.ID, 1, "Source file not exists")
	if thisTask.Files[1].Status != FsTask_Error {
		t.Errorf("subtask status = %s, want %s", thisTask.Files[1].Status, FsTask_Error)
	}
	if thisTask.Files[1].Error != "Source file not exists" {
		t.Errorf("subtask error = %q, want %q", thisTask.Files[1].Error, "Source file not exists")
	}
}

func TestSetFileOperationTaskEnded(t *testing.T) {
	tests := []struct {
		name         string
		endingSignal int
		errmsg       string
		wantStatus   string
	}{
		{"normal completion", filesystem.FsOpr_Continue, "", FsTask_Completed},
		{"cancelled by user", filesystem.FsOpr_Cancel, "", FsTask_Cancelled},
		{"ended with error", filesystem.FsOpr_Error, "Access Denied", FsTask_Error},
	}

	for i, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			thisTask := newTestFileOperationTask(t, "test_opr_end_"+string(rune('a'+i)), []int64{500})
			SetFileOperationTaskEnded(thisTask.ID, tt.endingSignal, tt.errmsg)

			if thisTask.Status != tt.wantStatus {
				t.Errorf("task status = %s, want %s", thisTask.Status, tt.wantStatus)
			}
			if thisTask.EndTime == 0 {
				t.Error("task end time should be set after the task ended")
			}
			if !taskIsFinished(thisTask) {
				t.Error("task should be reported as finished")
			}
			if thisTask.Files[0].Status == FsTask_Pending {
				t.Error("subtask should not be left in pending state after the task ended")
			}
		})
	}
}

// A file operation stopped by the user reports the abort as an error on its way
// out. That must be recorded as a cancellation, not as a failure.
func TestSetFileOperationTaskEndedAfterUserCancel(t *testing.T) {
	thisTask := newTestFileOperationTask(t, "test_opr_usercancel", []int64{500})
	thisTask.FileOperationSignal = filesystem.FsOpr_Cancel
	MarkFileOperationSubtaskEnded(thisTask.ID, 0, "Operation cancelled by user")

	SetFileOperationTaskEnded(thisTask.ID, filesystem.FsOpr_Error, "Operation cancelled by user")

	if thisTask.Status != FsTask_Cancelled {
		t.Errorf("task status = %s, want %s", thisTask.Status, FsTask_Cancelled)
	}
	if thisTask.Error != "" {
		t.Errorf("task error = %q, want it cleared", thisTask.Error)
	}
	if thisTask.Files[0].Status != FsTask_Cancelled {
		t.Errorf("subtask status = %s, want %s", thisTask.Files[0].Status, FsTask_Cancelled)
	}
	if thisTask.Files[0].Error != "" {
		t.Errorf("subtask error = %q, want it cleared", thisTask.Files[0].Error)
	}
}

func TestGetAllFileOperationForUser(t *testing.T) {
	ongoing := newTestFileOperationTask(t, "test_opr_list_1", []int64{100})
	finished := newTestFileOperationTask(t, "test_opr_list_2", []int64{100})
	SetFileOperationTaskEnded(finished.ID, filesystem.FsOpr_Continue, "")

	onlyOngoing := GetAllFileOperationForUser("test_user", false)
	if len(onlyOngoing) != 1 || onlyOngoing[0].ID != ongoing.ID {
		t.Errorf("expecting only the ongoing task to be listed, got %d task(s)", len(onlyOngoing))
	}

	all := GetAllFileOperationForUser("test_user", true)
	if len(all) != 2 {
		t.Errorf("expecting 2 tasks to be listed, got %d", len(all))
	}
	if len(all) == 2 && all[0].ID > all[1].ID {
		t.Error("task listing should be sorted by operation id")
	}

	if len(GetAllFileOperationForUser("another_user", true)) != 0 {
		t.Error("tasks of a user should not be visible to another user")
	}
}

func TestApplyFileOperationControl(t *testing.T) {
	thisTask := newTestFileOperationTask(t, "test_opr_control", []int64{100})

	if err := ApplyFileOperationControl("test_user", "pause", thisTask.ID); err != nil {
		t.Fatalf("pause returned error: %v", err)
	}
	if thisTask.FileOperationSignal != filesystem.FsOpr_Pause {
		t.Errorf("signal = %d, want %d", thisTask.FileOperationSignal, filesystem.FsOpr_Pause)
	}

	if err := ApplyFileOperationControl("test_user", "continue", thisTask.ID); err != nil {
		t.Fatalf("continue returned error: %v", err)
	}
	if thisTask.FileOperationSignal != filesystem.FsOpr_Continue {
		t.Errorf("signal = %d, want %d", thisTask.FileOperationSignal, filesystem.FsOpr_Continue)
	}

	//A running task cannot be removed from the listing
	if err := ApplyFileOperationControl("test_user", "remove", thisTask.ID); err == nil {
		t.Error("removing a running task should return an error")
	}

	//Another user must not be able to control this task
	if err := ApplyFileOperationControl("another_user", "cancel", thisTask.ID); err == nil {
		t.Error("controlling a task of another user should return an error")
	}

	//Unsupported commands are rejected
	if err := ApplyFileOperationControl("test_user", "explode", thisTask.ID); err == nil {
		t.Error("unsupported command should return an error")
	}

	//A finished task can be removed
	SetFileOperationTaskEnded(thisTask.ID, filesystem.FsOpr_Continue, "")
	if err := ApplyFileOperationControl("test_user", "remove", thisTask.ID); err != nil {
		t.Fatalf("removing a finished task returned error: %v", err)
	}
	if _, err := GetOngoingFileOperationByOprID(thisTask.ID); err == nil {
		t.Error("the removed task should no longer exist in the store")
	}
}

// Only a move can be handed to the storage as a rename. The paths of a move are
// resolved against the running storage pools, which a unit test has none of, so
// only the operation types are covered here.
func TestFileOperationCanBeRenamed(t *testing.T) {
	tests := []string{"copy", "zip", "unzip", ""}
	for _, operation := range tests {
		t.Run("operation "+operation, func(t *testing.T) {
			if fileOperationCanBeRenamed(operation, []string{"user:/a.txt"}, "user:/Desktop/") {
				t.Errorf("a %q operation should never be treated as a rename", operation)
			}
		})
	}
}

func TestClearExpiredFileOperationRecords(t *testing.T) {
	//An operation that is still running is never touched
	running := newTestFileOperationTask(t, "test_opr_expire_running", []int64{100})

	//A freshly finished operation is kept until a connected dialog has seen it
	justDone := newTestFileOperationTask(t, "test_opr_expire_fresh", []int64{100})
	SetFileOperationTaskEnded(justDone.ID, filesystem.FsOpr_Continue, "")

	//An operation that finished a while ago is cleared on its own
	oldDone := newTestFileOperationTask(t, "test_opr_expire_done", []int64{100})
	SetFileOperationTaskEnded(oldDone.ID, filesystem.FsOpr_Continue, "")
	oldDone.EndTime = time.Now().Unix() - fileOprFinishedRecordTTL - 5

	//So is one the user cancelled
	oldCancelled := newTestFileOperationTask(t, "test_opr_expire_cancelled", []int64{100})
	SetFileOperationTaskEnded(oldCancelled.ID, filesystem.FsOpr_Cancel, "")
	oldCancelled.EndTime = time.Now().Unix() - fileOprFinishedRecordTTL - 5

	//A failure is kept so the user can still look at it later
	oldError := newTestFileOperationTask(t, "test_opr_expire_error", []int64{100})
	SetFileOperationTaskEnded(oldError.ID, filesystem.FsOpr_Error, "Access Denied")
	oldError.EndTime = time.Now().Unix() - fileOprFinishedRecordTTL*100

	clearExpiredFileOperationRecords()

	kept := []struct {
		name string
		id   string
		want bool
	}{
		{"running operation", running.ID, true},
		{"operation that just finished", justDone.ID, true},
		{"operation finished long ago", oldDone.ID, false},
		{"operation cancelled long ago", oldCancelled.ID, false},
		{"failed operation", oldError.ID, true},
	}

	for _, tt := range kept {
		t.Run(tt.name, func(t *testing.T) {
			_, err := GetOngoingFileOperationByOprID(tt.id)
			if (err == nil) != tt.want {
				t.Errorf("record still exists = %v, want %v", err == nil, tt.want)
			}
		})
	}
}

func TestClearExpiredFileOperationRecordsTrimsErrorBacklog(t *testing.T) {
	//Failures are kept, but not without a bound
	newest := ""
	for i := 0; i < fileOprErrorRecordLimit+5; i++ {
		thisTask := newTestFileOperationTask(t, "test_opr_backlog_"+strconv.Itoa(i), []int64{100})
		SetFileOperationTaskEnded(thisTask.ID, filesystem.FsOpr_Error, "Access Denied")
		thisTask.EndTime = time.Now().Unix() - int64(fileOprErrorRecordLimit+5-i)
		newest = thisTask.ID
	}

	clearExpiredFileOperationRecords()

	remaining := 0
	for _, task := range GetAllFileOperationForUser("test_user", true) {
		if task.Status == FsTask_Error {
			remaining++
		}
	}
	if remaining != fileOprErrorRecordLimit {
		t.Errorf("kept %d failed records, want %d", remaining, fileOprErrorRecordLimit)
	}
	if _, err := GetOngoingFileOperationByOprID(newest); err != nil {
		t.Error("the newest failure should be among the records that are kept")
	}
}

func TestClearFinishedFileOperationForUser(t *testing.T) {
	ongoing := newTestFileOperationTask(t, "test_opr_clear_1", []int64{100})
	finished := newTestFileOperationTask(t, "test_opr_clear_2", []int64{100})
	SetFileOperationTaskEnded(finished.ID, filesystem.FsOpr_Continue, "")

	ClearFinishedFileOperationForUser("test_user")

	if _, err := GetOngoingFileOperationByOprID(finished.ID); err == nil {
		t.Error("the finished task should have been cleared")
	}
	if _, err := GetOngoingFileOperationByOprID(ongoing.ID); err != nil {
		t.Error("the ongoing task should not have been cleared")
	}
}
