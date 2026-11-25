package dirserv

import (
	"fmt"
	"mime"
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/filesystem/hidden"
	"imuslab.com/arozos/mod/info/logger"
)

func getPageHeader(pathname string) (out0 string) {
	defer logger.Out1(logger.In1("fileservers/servers/dirserv", "getPageHeader", "pathname", pathname), &out0)
	return `<!DOCTYPE HTML>
	<html>
		<head>
			<meta name="viewport" content="width=device-width, initial-scale=0.8" />
			<title>Index of ` + pathname + `</title>
			<style>
				body{
					padding: 14px;
					color: #2e2e2e;
					font-family: Arial;
				}

				hr{
					border: 0px;
					border-top: 1px solid #e8e8e8;
				}

				td{
					padding-left: 8px;
					border-left: 1px solid #dbdbdb;
					word-wrap: break-word;
					overflow-wrap: break-word;
					max-width: 25vw;
				}

				td.fx{
					border-left: 0px;
				}

				.textfield{
					min-width: 60px;
					text-align: left;
				}
			</style>
   		</head>
   		<body>
			<h2>Index of ` + pathname + `</h2>
		<hr>
		<table>
		<tr>
			<th></th>
			<th class="textfield">Name</th>
			<th class="textfield">Last Modify</th>
			<th class="textfield">Size</th>
			<th class="textfield"></th>
		</tr>
		`
}

func getItemHTML(displayText string, link string, isDir bool, modTime string, size string) (out0 string) {
	defer logger.Out1(logger.In5("fileservers/servers/dirserv", "getItemHTML", "displayText", displayText, "link", link, "isDir", isDir, "modTime", modTime, "size", size), &out0)
	icon := "📄"
	downloadBtn := ""
	hiddenStyle := ""
	if isDir {
		icon = "📁"
		isHidden, _ := hidden.IsHidden(link, true)
		if isHidden {
			//Hidden folder
			icon = "📁"
			hiddenStyle = "filter: alpha(opacity=50); opacity: 0.5;  zoom: 1;"
		}

		size = "-"
	} else {
		fileMime := mime.TypeByExtension(filepath.Ext(link))
		if strings.HasPrefix(fileMime, "audio/") {
			icon = "♫"
		} else if strings.HasPrefix(fileMime, "video/") {
			icon = "🎞"
		} else if strings.HasPrefix(fileMime, "image/") {
			icon = "🖼️"
		} else if strings.HasPrefix(fileMime, "text/") {
			icon = "📝"
		}
		//fmt.Println(fileMime, filepath.Ext(displayText))

		//Check if hidden file
		isHidden, _ := hidden.IsHidden(link, true)
		if isHidden {
			//Hidden folder
			hiddenStyle = "filter: alpha(opacity=50); opacity: 0.5;  zoom: 1;"
		}

		downloadBtn = `<a href="` + link + `" download>Download</a>`
	}
	return `<tr style="` + hiddenStyle + `">
		<td class="fx">` + icon + `</td>
		<td><a href="` + link + `">` + displayText + `</a></td>
		<td>` + modTime + `</td>
		<td>` + size + `</td>
		<td>` + downloadBtn + `</td>
	</tr>`
}

func getBackButton(currentPath string) (out0 string) {
	defer logger.Out1(logger.In1("fileservers/servers/dirserv", "getBackButton", "currentPath", currentPath), &out0)
	backPath := arozfs.ToSlash(filepath.Dir(currentPath))
	return `<tr>
		<td class="fx">←</td>
		<td colspan="3"><a href="` + backPath + `">Back</a></td>	
	</tr>`
}

func getPageFooter() (out0 string) {
	defer logger.Out1(logger.In0("fileservers/servers/dirserv", "getPageFooter"), &out0)
	return `</table><hr>
		<img src="/img/public/compatibility.png" style="display: inline-block; width: 120px;"></img>
		</body>
	</html>`
}

/*
	Utilities
*/

func byteCountIEC(b int64) (out0 string) {
	defer logger.Out1(logger.In1("fileservers/servers/dirserv", "byteCountIEC", "b", b), &out0)
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %ciB",
		float64(b)/float64(div), "KMGTPE"[exp])
}
