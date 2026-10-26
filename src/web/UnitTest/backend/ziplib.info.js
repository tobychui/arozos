/*
	Test: ziplib.getZipFileInfo and ziplib.addFileToZip

	Creates a zip, reads its metadata, adds a file, checks updated metadata.
*/
requirelib("filelib");
requirelib("ziplib");

var srcFile = "tmp:/ziplib_info_src.txt";
var addFile = "tmp:/ziplib_info_add.txt";
var testZip = "tmp:/ziplib_test_info.zip";

filelib.writeFile(srcFile, "Initial file for zip info test");
filelib.writeFile(addFile, "Second file added to test addFileToZip");

// Create initial zip
var ok = ziplib.createZipFile([srcFile], testZip);
if (!ok) {
	sendJSONResp(JSON.stringify({error: "Failed to create test zip"}));
} else {
	// Get info before adding
	var infoBefore = JSON.parse(ziplib.getZipFileInfo(testZip));
	if (infoBefore.fileCount !== 1) {
		sendJSONResp(JSON.stringify({error: "Expected 1 file before add, got: " + infoBefore.fileCount}));
	} else {
		// Add a second file
		var addOk = ziplib.addFileToZip(testZip, addFile);
		if (!addOk) {
			sendJSONResp(JSON.stringify({error: "addFileToZip returned false"}));
		} else {
			var infoAfter = JSON.parse(ziplib.getZipFileInfo(testZip));
			if (infoAfter.fileCount !== 2) {
				sendJSONResp(JSON.stringify({error: "Expected 2 files after add, got: " + infoAfter.fileCount}));
			} else {
				sendJSONResp(JSON.stringify({
					success: true,
					before: infoBefore,
					after: infoAfter
				}));
			}
		}
	}
}
