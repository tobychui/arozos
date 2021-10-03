package main

/*
	Device Handler

	This script mainly handle the external devices like client devices reflect information
	or IoT devices. If you want to handle storage devices mounting, use system.storage.go instead.
*/

func DeviceServiceInit() {
	//Register Device related settings. Compatible to ArOZ Online Beta
	registerSetting(settingModule{
		Name:     "Client Device",
		Desc:     "Detail about the browser you are using",
		IconPath: "SystemAO/info/img/small_icon.png",
		Group:    "Device",
		StartDir: "SystemAO/info/clientInfo.html",
	})

	registerSetting(settingModule{
		Name:     "Audio Testing",
		Desc:     "Speaker and volume testing",
		IconPath: "SystemAO/info/img/small_icon.png",
		Group:    "Device",
		StartDir: "SystemAO/info/audio.html",
	})

	registerSetting(settingModule{
		Name:     "Display Testing",
		Desc:     "Display testing tools",
		IconPath: "SystemAO/info/img/small_icon.png",
		Group:    "Device",
		StartDir: "SystemAO/info/display.html",
	})

	/*
		Locale / Display Language

		This method allows users to change their own language
	*/
	registerSetting(settingModule{
		Name:         "Language",
		Desc:         "Set the display language of the system",
		IconPath:     "SystemAO/info/img/small_icon.png",
		Group:        "Device",
		StartDir:     "SystemAO/info/locale.html",
		RequireAdmin: false,
	})
}
