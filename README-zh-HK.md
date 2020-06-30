![Image](img/banner.png?raw=true)

<img src="https://img.shields.io/badge/License-Partially%20Open%20Source-blue"> <img src="https://img.shields.io/badge/Build-Community-brightgreen"> <img src="https://img.shields.io/badge/Device-Raspberry%20Pi%203B%2B%20%2F%204B-red"> <img src="https://img.shields.io/badge/Made%20In-Hong%20Kong-blueviolet">

# ArOZ Online 系統 / aCloud
為 Raspberry Pi 3B + 或 4B 裝置度身訂造的網頁桌面環境個人雲平台。可以用作雲音樂和影片流，數據存儲，簡易辦公/文書處理，3D列印文件預覽，雲編程IDE等等喔！

## 快速開始
本說明將向您展示如何在自己的Raspberry Pi或其他運行 Linux 的單晶片電腦上安裝ArOZ Online系統。

### 系統要求
運行本系統需要安裝以下軟體。
- apache2
- libapache2-mod-xsendfile
- php libapache2-mod-php php-cli php-common php-mbstring php-gd php xml php-zip
- php-mysql (可選)
- libav-tools / ffmpeg (可選)
- samba (可選)

要安裝以上軟件包，請逐行複製以下行並將其貼上到ssh終端內。
```bash
# 如果您使用新安裝的 Debian Buster 系統，請執行以下指令以安裝所需軟體。
sudo apt-get install unzip net-tools ntfs-3g -y
sudo apt-get update
sudo apt-get install -y apache2
sudo apt-get install -y php libapache2-mod-php php-cli php-common php-mbstring php-gd php xml php-zip 
sudo apt-get install libapache2-mod-xsendfile
# 以下指令安裝可選的軟體套件，並非必要，但安裝後能對將來更多用戶提供更好體驗。
sudo apt-get install php-mysql
# 如果您的Debian版本仍為 Debian Jessie ，請以 libav-tools 取代 ffmpeg
sudo apt-get install ffmpeg
sudo apt-get install samba
```
### 預建映像檔案
要將ArOZ Online System安裝到Raspberry pi，您可以使用Raspberry Pi 4B / 3B +的預構建映像檔案。您可以在下面的網址中找到該映像檔：

> 還沒準備好喔！

### 手動安裝

#### 概覽

ArOZ Online 支援 Debian Jessie 和 Debian Buster 作為其底系統。在安裝ArOZ Online 系統之前，請先安裝[所需軟體套件](#系統要求)。

#### 設定PHP

ArOZ Online 不支援預設的 PHP 設定。

更改 php.ini 的內容以增加最大文件上傳大小設定。在 Debian 系統中，`php.ini` 文件通常可以在 `/etc/php/{php-version}/apache2/php.ini` 找到。請依照以下來更改 `php.ini` 中的設定值。

  ```
upload_max_filesize = 2048M
post_max_size = 2048M
  ```

#### 設定權限

部分功能需要特別的權限設定才能啟用。

如果你對 Linux 權限設定不太熟悉，你可以直接使用 `nano` 打開 `/etc/sudoers`，並在檔案尾端加上以下一行。

  ```
www-data ALL=NOPASSWD: /usr/bin/mount, /sbin/mount.ntfs-3g, /usr/bin/umount, /sbin/halt, /sbin/reboot, /sbin/poweroff, /sbin/ifconfig, /sbin/ip
  ```
  **(此行只限於個人內聯網中使用。如果你打算把此系統開放到互聯網，請自行根據下面的提示進行設定。)**

- 允許使用者透過 ArOZ Online 系統載入及移除外置儲存裝置

      www-data ALL=NOPASSWD: /usr/bin/mount, /sbin/mount.ntfs-3g, /usr/bin/umount
  
- 允許使用者透過網頁界面關閉、重啟伺服器

      www-data ALL=NOPASSWD: /sbin/halt, /sbin/reboot, /sbin/poweroff
  
- 允許 ArOZ Online 系統存取網絡及 WiFi 設定

      www-data ALL=NOPASSWD: /sbin/ifconfig, /sbin/ip
  
- 允許 ArOZ Online 系統建立新的 NTFS 或 FAT32 檔案系統

      www-data ALL=NOPASSWD: /sbin/mkfs.ntfs, /sbin/mkfs.vfat

> TO BE ADDED

#### Apache 設定

編輯 `/etc/apache2/apache2.conf`文件，在檔案尾端部加入以下兩行。

  ```
XSendFile on
XSendFilePath /media
  ```

#### 建立目錄

在 `/media/storage1` 和 `/media/storage2` 新建兩個目錄。

  ```bash
sudo mkdir /media/storage1 /media/storage2
  ```
#### 安裝 ArOZ Online 至網頁伺服器

您需要下載ArOZ Online 系統並將其安裝到您網頁伺服器的根目錄（`/var/www/html/`）。
您可以使用以下命令移動到網頁伺服器的根目錄。

  ```bash
cd /var/www/html/
  ```

然後以 zip 格式下載此源碼庫，將 `src` 文件夾解壓縮至 `/var/www/html` 然後將 `src`目錄更名為 `AOB`。
在 Windows 作業系統中，您可以下載並使用 WinSCP 來進行此操作。否則，您可以使用 `git clone` 指令，可參考於下面的示例。在使用 `git` 命令之前，請確保已安裝 `git` 軟體。您可以執行 ```sudo apt-get install git``` 以安裝之。

  ```bash
git clone https://github.com/tobychui/ArOZ-Online-System/
sudo mv ArOZ-Online-System/src ./AOB
sudo rm -rf ./ArOZ-Online-System
  
sudo mkdir -p "/etc/AOB"
sudo chmod 777 -R "/etc/AOB"
sudo chmod 777 -R ./AOB
sudo chown -R www-data ./
  ```

#### 首次登入

使用你喜歡的瀏覽器打開：`http://{Raspberry_Pi_IP_Address}/AOB/`，然後跟據網頁上的指示建立新用戶。

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
