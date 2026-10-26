/*
	Test: ziplib.listZipFileDir and ziplib.listZipFileContents

	Creates a temporary zip, lists its contents, then cleans up.
*/
requirelib("filelib");
requirelib("ziplib");

// Create a small test zip from an existing known file
var testSrc = "user:/Desktop/test.txt";
var testZip = "tmp:/ziplib_test_list.zip";

// Make sure we have a source file to zip
if (!filelib.fileExists(testSrc)) {
	filelib.writeFile(testSrc, "ziplib list test content");
}

// Create zip
var ok = ziplib.createZipFile([testSrc], testZip);
if (!ok) {
	sendJSONResp(JSON.stringify({error: "Failed to create test zip"}));
} else {
	// List root contents
	var items = ziplib.listZipFileDir(testZip, "");
	if (!Array.isArray(items) || items.length === 0) {
		sendJSONResp(JSON.stringify({error: "listZipFileDir returned empty or non-array"}));
	} else {
		// List zip as tree
		var tree = ziplib.listZipFileContents(testZip);
		var treeObj = JSON.parse(tree);
		sendJSONResp(JSON.stringify({
			success: true,
			rootItems: items,
			treeRoot: treeObj.name
		}));
	}
}
