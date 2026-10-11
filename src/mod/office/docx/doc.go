/*
Package docx converts between the Docs document model and Word 2007+
(.docx, WordprocessingML) files.

	Parse       .docx bytes -> *model.Document, so the file looks in the
	            editor the way it looked in Word (reader.go, props.go,
	            numbering.go, picture.go)
	Build       *model.Document -> .docx, pictures inline
	BuildMedia  the same, reading media?file= picture links through a
	            resolver (writer.go)

Comments and suggested edits map onto Word's own comments and revisions
(review.go). The legacy binary .doc format is read by package doc, which
converts it into a .docx for Parse.
*/
package docx
