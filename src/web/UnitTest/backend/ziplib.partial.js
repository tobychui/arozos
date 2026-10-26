/*
	Test: ziplib.extractPartialZip

	Creates a zip with two files, extracts only one of them, verifies the result.
*/
requirelib("filelib");
requirelib("ziplib");

var fileA = "tmp:/ziplib_partial_a.txt";
var fileB = "tmp:/ziplib_partial_b.txt";
var testZip = "tmp:/ziplib_test_partial.zip";
var destDir = "tmp:/ziplib_partial_out/";

filelib.writeFile(fileA, "File A content for partial extraction test");
filelib.writeFile(fileB, "File B content that should NOT be extracted");

// Create zip with both files
var ok = ziplib.createZipFile([fileA, fileB], testZip);
if (!ok) {
	sendJSONResp(JSON.stringify({error: "Failed to create test zip"}));
} else {
	// Extract only fileA by its name inside the zip
	var items = ziplib.listZipFileDir(testZip, "");
	if (!Array.isArray(items) || items.length < 2) {
		sendJSONResp(JSON.stringify({error: "Expected 2 items in zip, got: " + JSON.stringify(items)}));
	} else {
		// Extract just the first file
		var firstFile = items[0];
		var extractOk = ziplib.extractPartialZip(testZip, [firstFile], destDir);
		if (!extractOk) {
			sendJSONResp(JSON.stringify({error: "extractPartialZip returned false"}));
		} else {
			sendJSONResp(JSON.stringify({
				success: true,
				allItems: items,
				extracted: firstFile
			}));
		}
	}
}
