![Image](img/banner.png?raw=true)

<img src="https://img.shields.io/badge/License-Partially%20Open%20Source-blue"> <img src="https://img.shields.io/badge/Build-Community-brightgreen"> <img src="https://img.shields.io/badge/Device-Raspberry%20Pi%203B%2B%20%2F%204B-red"> <img src="https://img.shields.io/badge/Made%20In-Hong%20Kong-blueviolet">

# ArOZ Online 系統 / aCloud
設計給 Raspberry Pi 3B + 或 4B 的網頁桌面環境個人雲平台。可以用作雲音樂和影片流，數據存儲，簡易辦公/文書處理，3D列印文件預覽，雲編程IDE等等喔！

## 快速開始
本說明將向您展示如何在自己的Raspberry Pi或其他單片電腦的 Linux上安裝ArOZ Online系統。

### 系統要求
要在Linux系統上運行該系統，需要以下軟件包。
- apache2
- libapache2-mod-xsendfile
- php libapache2-mod-php php-cli php-common php-mbstring php-gd php xml php-zip
- php-mysql (可選)
- libav-tools / ffmpeg (可選)
- samba (可選)

要安裝以上軟件包，請逐行複製以下行並將其貼上到ssh終端內。
```
#Add the following line if you are using a fresh install of Debian Buster
sudo apt-get install unzip net-tools ntfs-3g -y
sudo apt-get update
sudo apt-get install -y apache2
sudo apt-get install -y php libapache2-mod-php php-cli php-common php-mbstring php-gd php xml php-zip 
sudo apt-get install libapache2-mod-xsendfile
#The lines below are optional. But it is recommended to install them for future uses
sudo apt-get install php-mysql
#Use libav-tools instead of ffmpeg if you are still using Debian Jessie
sudo apt-get install ffmpeg
sudo apt-get install samba
```
### 預建映像檔案
要將ArOZ Online System安裝到Raspberry pi，您可以使用Raspberry Pi 4B / 3B +的預構建映像檔案。您可以在下面的網址中找到該映像檔：

還沒準備好喔！

### 手動安裝
ArOZ Online 系統已經過測試可安裝在Debian Jessie和Debian Buster上。在安裝ArOZ Online 系統之前，您需要先行調整設定。

1. 編輯 php.ini以增加最大文件上傳大小設置。 php.ini文件通常可以在 /etc/php/{php-version}/apache2/php.ini 找到. 如下所示的更改這兩行：
  ```
  upload_max_filesize = 2048M
  post_max_size = 2048M
  ```
  
2. 編輯 /etc/sudoers, 並在檔案底部加上以下一行：
  ```
  www-data ALL=(ALL:ALL) NOPASSWD:ALL
  ```
  **（注：此行只適合使用者於內聯網存取本系統。如果你想從互聯網存取此系統，你需要自行更改此設定以保障系統安全性。）**
  
3. 編輯 /etc/apache2/apache2.conf, 在檔案底部加上這兩行：
  ```
  XSendFile on
  XSendFilePath /media
  ```
  
4. 在 /media/storage1 和 /media/storage2 新建兩個資料夾
  ```
  sudo mkdir /media/storage1 /media/storage2
  ```
接下來，您需要下載ArOZ在線系統並將其安裝到您的webroot（/ var / www / html /）。
為此，您可以使用以下命令移動到網絡伺服器的根目錄：
  ```
  cd /var/www/html/
  ```

然後以 zip格式下載此源碼庫，將 "src" 文件夾解壓縮到 /var/www/html 然後將 "src" 命名為 "AOB"。
如果你是在使用 Windows 作業系統，你可以下載並使用 WinSCP 來進行此操作. 否則，您可以使用git clone命令，類似於下面的示例。在使用git命令之前，請確保已安裝 git 軟件。如果你還沒安裝你可以用 ```sudo apt-get install git``` 來進行安裝。

  ```
  git clone https://github.com/tobychui/ArOZ-Online-System/
  sudo mv ArOZ-Online-System/src ./AOB
  sudo rm -rf ./ArOZ-Online-System
  
  sudo mkdir -p "/etc/AOB"
  sudo chmod 777 -R "/etc/AOB"
  sudo chmod 777 -R ./AOB
  sudo chown -R www-data ./
  ```
  
  使用你喜歡的瀏覽器打開： http://{Raspberry_Pi_IP_Address}/AOB/ 然後跟據屏幕上的指南設置新用戶。

## 系統截圖
![Image](img/screenshots/audio.png?raw=true)
![Image](img/screenshots/photo.png?raw=true)
![Image](img/screenshots/video.png?raw=true)
![Image](img/screenshots/listmenu.png?raw=true)
![Image](img/screenshots/fileexp.png?raw=true)
![Image](img/screenshots/async-fileopr.png?raw=true)
![Image](img/screenshots/diskman.png?raw=true)
![Image](img/screenshots/settings.png?raw=true)
點 <a href="https://github.com/tobychui/ArOZ-Online-System/tree/master/img/screenshots">這裡</a> 以看更多系統截圖

## 版本號
 以下是ArOZ在線系統當前提供的版本列表。

| Version Number | Code Name | Major Change | Type (Barebone / Pre-release / Full* ) |
|----------------|-----------|--------------|---------------------------------------------|
| Before Beta 1.1.4     | Aloplex                  | N/A          | Full                         |
| Before Beta 1.2.8     | Sempervivum Tectorum     | N/A          | Full                         |
| Beta 12-06-2019       | aCloud                   | Init Release | Pre-release                  |

*完整版本僅向內部開發人員或測試人員公開。

## 作者
### 開發者
* tobychui - 項目發起人/系統開發人員/核心模塊設計人員和程序員
* <a href="https://github.com/yeungalan">yeungalan</a> - 模塊維護人員/網絡設置模塊開發人員

### Beta 測試人員
* <a href="https://github.com/aceisace">aceisace</a>
* <a href="https://github.com/RubMing">RubMing</a>

## 使用授權
（注：使用授權的中文翻譯只供參考之用，一切以英文版本為準。）

內置多媒體模塊 (Audio / Photo / Video) - MIT授權

桌面模塊（Desktop）及其子程式 - *保留所有權利*，僅可在Raspberry Pi和其他基於ARMv6，v7或ARM64的SBC上免費用於非商業目的。 不得 fork 此模塊並進行任何私人修改、重製、公開、改作、散布、發行、公開發表、進行還原工程、解編或反向組譯。 但是我們歡迎任何改進的請求。

根目錄下（./）和系統腳本文件夾內（SystemAOB/*）的所有核心腳本和二進製文件 - tobychui feat ArOZ Online計劃，保留所有權利。

以上許可證未涵蓋的所有其他文件或模塊-有關更多信息，請參閱模塊的許可證。

請注意，部份軟件包可能適用於美國出口管制，如閣下或貴公司或貴用戶所在地於美國貿易禁運國家名單，美國商務部拒絕往來名單或美國財政部特別指定國民名單上，則你可能無法使用本軟件的部分或全部功能。

THIS SOFTWARE IS ONLY FOR PERSONAL AND NON COMMERCIAL USE ONLY. RE-SELL ,DISTRIBUTE OR CLAIM THIS AS YOUR OWN WORK IS PROHIBITED

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*Please seek for author approval if you want to deploy this system for purposes other than personal (e.g. home NAS, private media server, automation control in your room etc) and educational (e.g. school projects, course demos etc)*

*請注意本軟件僅限於個人或非商業用途（包括但只限於家庭NAS，私人媒體服務器，房間中的自動化控制等）或教育目的（包括但只限於學校項目，課程演示等），如需用作商業用途，請先向作者取得使用授權*

## 致謝
TocasUI by Yami Odymel - https://tocas-ui.com/ 

## 支持本系統開發
如果您真的想給我一些東西，歡迎隨時與我聯絡 :)



