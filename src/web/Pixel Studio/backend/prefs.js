/*
	Pixel Studio - Per-user preference storage

	Stores the user's editor preferences (last used tool options, colors,
	panel states) in the system database so they survive sessions.

	Parameters:
	  action = "get"            - return the stored preference JSON
	  action = "set", data=JSON - store the given preference JSON

	The "Pixel Studio" DB table is created by init.agi on system startup.
*/

function main() {
	if (typeof(action) == "undefined") {
		sendJSONResp(JSON.stringify({
			error: "action parameter is required"
		}));
		return;
	}

	//Make sure the table exists even if init.agi has not run yet
	newDBTableIfNotExists("Pixel Studio");

	var key = "prefs/" + USERNAME;

	if (action == "get") {
		var stored = readDBItem("Pixel Studio", key);
		if (stored == false || stored == "") {
			sendJSONResp(JSON.stringify({}));
		} else {
			//stored is already a JSON string
			sendJSONResp(stored);
		}
	} else if (action == "set") {
		if (typeof(data) == "undefined") {
			sendJSONResp(JSON.stringify({
				error: "data parameter is required"
			}));
			return;
		}

		//Validate that the payload is valid JSON before storing
		try {
			JSON.parse(data);
		} catch (e) {
			sendJSONResp(JSON.stringify({
				error: "data is not valid JSON"
			}));
			return;
		}

		writeDBItem("Pixel Studio", key, data);
		sendJSONResp(JSON.stringify({
			ok: true
		}));
	} else {
		sendJSONResp(JSON.stringify({
			error: "unknown action: " + action
		}));
	}
}

main();
