/*
	Test: 7z archive support in ziplib

	Verifies list7zFileDir, list7zFileContents, getFileFrom7z,
	get7zFileInfo, and extractPartial7z using a real .7z file.

	The test expects a file at user:/Desktop/test.7z to already exist.
	If it does not, the test is skipped with a clear message.
*/
requirelib("filelib");
requirelib("ziplib");

var testArchive = "user:/Desktop/test.7z";

if (!filelib.fileExists(testArchive)) {
	sendJSONResp(JSON.stringify({
		skipped: true,
		reason: "test.7z not found at user:/Desktop/test.7z — place a sample 7z archive there to run this test"
	}));
} else {
	try {
		// ── 1. List root directory ─────────────────────────────
		var rootItems = ziplib.list7zFileDir(testArchive, "");
		if (!Array.isArray(rootItems)) {
			sendJSONResp(JSON.stringify({error: "list7zFileDir did not return an array"}));
		}

		// ── 2. Also verify the generic listZipFileDir dispatches ──
		var genericItems = ziplib.listZipFileDir(testArchive, "");
		if (!Array.isArray(genericItems)) {
			sendJSONResp(JSON.stringify({error: "generic listZipFileDir did not dispatch to 7z"}));
		}

		// ── 3. Full contents tree ──────────────────────────────
		var treeJSON = ziplib.list7zFileContents(testArchive);
		var tree = JSON.parse(treeJSON);
		if (!tree || tree.name !== "/") {
			sendJSONResp(JSON.stringify({error: "list7zFileContents tree root name unexpected: " + treeJSON}));
		}

		// ── 4. Archive metadata ────────────────────────────────
		var infoJSON = ziplib.get7zFileInfo(testArchive);
		var info = JSON.parse(infoJSON);
		if (typeof info.fileCount !== "number") {
			sendJSONResp(JSON.stringify({error: "get7zFileInfo missing fileCount: " + infoJSON}));
		}

		// ── 5. Extract a single file to tmp:/ ─────────────────
		var firstFile = null;
		for (var i = 0; i < rootItems.length; i++) {
			if (!rootItems[i].endsWith("/")) {
				firstFile = rootItems[i];
				break;
			}
		}

		var previewResult = null;
		if (firstFile !== null) {
			var tmpPath = ziplib.getFileFrom7z(testArchive, firstFile);
			if (!tmpPath || tmpPath === "") {
				sendJSONResp(JSON.stringify({error: "getFileFrom7z returned empty path for: " + firstFile}));
			}
			previewResult = tmpPath;

			// Also verify generic getFileFromZip dispatches
			var genericTmp = ziplib.getFileFromZip(testArchive, firstFile);
			if (!genericTmp || genericTmp === "") {
				sendJSONResp(JSON.stringify({error: "generic getFileFromZip did not dispatch to 7z"}));
			}
		}

		// ── 6. Partial extraction ──────────────────────────────
		var destDir = "tmp:/7z_partial_out/";
		var extractPaths = rootItems.slice(0, 1); // first item only
		var extractOk = ziplib.extractPartial7z(testArchive, extractPaths, destDir);
		if (!extractOk) {
			sendJSONResp(JSON.stringify({error: "extractPartial7z returned false"}));
		}

		// ── 7. Detect type via generic function ────────────────
		var detectedType = ziplib.getCompressFileType(testArchive);
		if (detectedType !== "7z") {
			sendJSONResp(JSON.stringify({error: "getCompressFileType returned '" + detectedType + "', expected '7z'"}));
		}

		sendJSONResp(JSON.stringify({
			success: true,
			rootItemCount: rootItems.length,
			rootItems: rootItems,
			treeRoot: tree.name,
			fileCount: info.fileCount,
			dirCount: info.dirCount,
			totalUncompressedSize: info.totalUncompressedSize,
			previewTmpPath: previewResult,
			extractedTo: destDir,
			detectedType: detectedType
		}));

	} catch(e) {
		sendJSONResp(JSON.stringify({error: e.toString()}));
	}
}
