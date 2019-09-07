# ArOZ Online System Theme Manager
Due to the fact that ArOZ Online System build in Theme changing setting is too advance and complicated for newbies, a manager is written to make changing color of the functional bar less painful.

## How to add a theme
Create an index and a System Standard Config File and put them into the index/ and conf/ directory respectivly. Beware to match their filename.

The index file is a json file containing three color information.
1. Functional Bar Color
2. Menu Button Color
3. Activated Menu Button Color

in JSON array format. Here is an example of it.

```
["rgba(48,48,48,0.7)","rgba(68, 68, 68,1)","rgba(34, 34, 34,1)"]
```

And for the config file, it follows the System Standard Config File Format. Here is an example of the function_bar.config.

```
{"fbcolor":["Function Bar Color","Functional menu bar background color in RGBA format, e.g. rgba(48,48,48,0.7)","text","rgba(48,48,48,0.7)"],
  "nbcolor":["Notification Bar Color","Notification Sidebar color in RGBA format  e.g. rgba(48,48,48,0.7)","text","rgba(48,48,48,0.7)"],
  "nbfontcolor":["Notification Bar Default Font Color","The default font color for pop-up notification. Default white.","text","white"],
  "resizeInd":["Resize Indicator Icon","Filepath for the indicator image file.","file","img/sys/scalable.png"],
  "defBtnColor":["Default Button Color","The default color of the buttons on function bar in RGBA format. Default rgba(68, 68, 68,1). ","text","rgba(68, 68, 68,1)"],
  "actBtnColor":["Active Button Color","The default color of activated buttons in RGBA format. Default rgba(34, 34, 34,1)", "text", "rgba(34, 34, 34,1)"]
}
```