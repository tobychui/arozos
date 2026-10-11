/*
Package pptx converts between the Slides presentation model and PowerPoint
2007+ (.pptx, PresentationML) files.

	Parse         .pptx bytes -> *model.Presentation, resolving the
	              master / layout / slide inheritance, theme colours,
	              text styles, tables, charts, pictures and custom
	              geometry into the editor's 960 px wide slide space
	Build         *model.Presentation -> .pptx
	BuildMedia    the same, plus the media sidecar zip for video / audio
	BuildPackage  the .pptx alone, with or without the sidecar

The legacy binary .ppt format is read by package ppt, which converts it
into a .pptx for Parse.
*/
package pptx
