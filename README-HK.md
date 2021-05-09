![Image](img/banner.png?raw=true)

<img src="https://img.shields.io/badge/License-Open%20Source-blue"> <img src="https://img.shields.io/badge/Device-Raspberry%20Pi%203B%2B%20%2F%204B-red"> <img src="https://img.shields.io/badge/Made%20In%20Hong%20Kong-香港開發-blueviolet">

譯：tobychui

## 特點

### 使用者界面

- 網頁桌面作業系統 (可能好過 Synology 嗰個 DSM)
- Ubuntu 撈 Windows 風格嘅開始功能表同埋工具欄
- 乾淨又易用嘅檔案管理員（仲支持 drag & drop 添）
- 簡約嘅系統設定界面
- 直接易明嘅模組命名模式

### 網絡與連接

- FTP 伺服器
- WebDAV 伺服器
- UPnP 通訊埠轉發
- Samba （由第三方插件支援）
- WiFi 管理 （剩係支持 Raspberry Pi 嘅 wpa_supplicant 同埋 Armbian 嘅 nmcli ）

### 檔案 / 磁碟管理

- 掛載 / 格式化硬碟工具（支援 NTFS 、EXT4 之類嘅格式）
- 虛擬檔案系統架構
- （類似 Google Drive 嘅）文件分享模式
- 即時睇到嘅檔案管理功能 （複製、剪下、貼上、新增檔案、資料夾等等）

### 其他

- 剩係需要 512MB 嘅系統記憶體同埋 8GB 嘅儲存空間就行到㗎啦
- 系統基於其中一個最穩定嘅 Linux 系統 — Debian
- 無論係 Desktop、Laptop 同埋手機嘅 mon size 都支援



## 安裝

需要 GO 1.14 或以上 （見 [Instllation tutorial](https://dev.to/tobychui/install-go-on-raspberry-pi-os-shortest-tutorial-4pb)）

要 build 嘅時候跟住打下面呢幾句指令：

```
git clone https://github.com/tobychui/arozos
cd ./arozos/src/
go build
```

（就喺咁簡單㗎炸）

## Deploy （部署 / 配置）

### 喺 Raspberry Pi 上面裝 (使用 Raspberry Pi 4B+)

如果你打算用 Raspberry Pi 作為你部 Host，你可以選擇下載下面其中一個映像檔，然後將映像檔燒入去你張 SD 卡入面。 之後你會喺 Windows 個 「網路上的芳鄰」入面見到嗰 「ArozOS（ARxxx）」 嘅新野彈出嚟。 Double click 佢個 icon，佢就會彈你過去 ArozOS 個設定網頁。 如果你喺你個芳鄰入面搵唔到有新裝置彈出嚟，你亦都可以通過用瀏覽器打開 ```http://{raspberry_pi_ip_address}:8080/``` 嚟直接連接到 ArozOS。 

【注：見英文版 README 嘅下載列表】


**所有映像檔都需要最少 8GB 嘅 SD 卡先用得**

上面嘅映像檔都係經過壓縮，如果你無裝 7zip 打唔開嘅話去呢度 ->  [here](https://www.7-zip.org/download.html)

### 裝落去其他 ARM SBC(例如 Orange Pi / Banana Pi / Friendly ARM 的 Pis)

去 Release 頁面下載適當系統架構嘅執行檔，然後將 web 同埋 system 兩個資料夾放去同個執行檔同一個資料夾入面。下載完成之後你應該有一堆咁嘅野：

```
$ ls
arozos_linux_arm64  web  system
```

你可以用 ``` sudo ./aroz_online_linux_arm64 ``` 嚟執行個執行檔，如果你唔鐘意比咁多權限佢你可以省略個 sudo（但係 ArozOS 就會讀取唔到你部機啲 hardware 咁解囉）

### Windows

如果你死都要係 Windows 上面裝，記得將 ffmpeg 加入去 %PATH% （系統環境變數）裡面。

如果你要係 Windows 上面 build 嘅話，你可以用以下指令：

```
# Download the whole repo as zip and cd into it
cd .\arozos\src\
go build
arozos.exe
```

**嗱，話明呢套野係比 ARM + Linux 用，所以 Windows 上面行啲功能唔齊唔好怪我** 

## Docker

多謝 大神 [Saren](https://github.com/Saren-Arterius) 幫我整咗個 DockerFile

 客官呢邊 -> [here](https://github.com/Saren-Arterius/aroz-dockerize)

## 截圖

![Image](img/screenshots/1.png?raw=true)
![Image](img/screenshots/2.png?raw=true)
![Image](img/screenshots/3.png?raw=true)
![Image](img/screenshots/4.png?raw=true)
![Image](img/screenshots/5.png?raw=true)
![Image](img/screenshots/6.png?raw=true)

## 啟動 ArozOS 

### 支援的啟動參數

以下為 ArozOS 的啟動參數 (版本 1.110)

```
  -allow_autologin
    	Allow RESTFUL login redirection that allow machines like billboards to login to the system on boot (default true)
  -allow_mdns
    	Enable MDNS service. Allow device to be scanned by nearby ArOZ Hosts (default true)
  -allow_pkg_install
    	Allow the system to install package using Advanced Package Tool (aka apt or apt-get) (default true)
  -allow_ssdp
    	Enable SSDP service, disable this if you do not want your device to be scanned by Windows's Network Neighborhood Page (default true)
  -allow_upnp
    	Enable uPNP service, recommended for host under NAT router
  -beta_scan
    	Allow compatibility to ArOZ Online Beta Clusters
  -cert string
    	TLS certificate file (.crt) (default "localhost.crt")
  -console
    	Enable the debugging console.
  -demo_mode
    	Run the system in demo mode. All directories and database are read only.
  -dir_list
    	Enable directory listing (default true)
  -disable_ip_resolver
    	Disable IP resolving if the system is running under reverse proxy environment
  -disable_subservice
    	Disable subservices completely
  -enable_homepage
    	Redirect not logged in users to home page instead of login interface
  -enable_hwman
    	Enable hardware management functions in system (default true)
  -hostname string
    	Default name for this host (default "My ArOZ")
  -iobuf int
    	Amount of buffer memory for IO operations (default 1024)
  -key string
    	TLS key file (.key) (default "localhost.key")
  -max_upload_size int
    	Maxmium upload size in MB. Must not exceed the available ram on your system (default 8192)
  -ntt int
    	Nightly tasks execution time. Default 3 = 3 am in the morning (default 3)
  -port int
    	Listening port (default 8080)
  -public_reg
    	Enable public register interface for account creation
  -root string
    	User root directories (default "./files/")
  -session_key string
    	Session key, must be 16, 24 or 32 bytes long (AES-128, AES-192 or AES-256). Leave empty for auto generated.
  -storage_config string
    	File location of the storage config file (default "./system/storage.json")
  -tls
    	Enable TLS on HTTP serving
  -tmp string
    	Temporary storage, can be access via tmp:/. A tmp/ folder will be created in this path. Recommend fast storage devices like SSD (default "./")
  -tmp_time int
    	Time before tmp file will be deleted in seconds. Default 86400 seconds = 24 hours (default 86400)
  -upload_async
    	Enable file upload buffering to run in async mode (Faster upload, require RAM >= 8GB)
  -upload_buf int
    	Upload buffer memory in MB. Any file larger than this size will be buffered to disk (slower). (default 25)
  -uuid string
    	System UUID for clustering and distributed computing. Only need to config once for first time startup. Leave empty for auto generation.
  -version
    	Show system build version
  -wlan_interface_name string
    	The default wireless interface for connecting to an AP (default "wlan0")
  -wpa_supplicant_config string
    	Path for the wpa_supplicant config (default "/etc/wpa_supplicant/wpa_supplicant.conf")
```

例子

```
//Starting aroz online with standard web port
./arozos -port 80

//Start aroz online in demo mode
./arozos -demo_mode=true

//Use https instead of http 
./arozos -tls=true -key mykey.key -cert mycert.crt

//Change max upload size to 25MB
./arozos -max_upload_size 25

```

詳細說明去睇 documentation （英文）

### 儲存池設置

#### Deploy 一部機

如果你只喺 deploy 緊一部機，你裝好套系統之後可以入去 System Setting > Disk & Storage > Storage Pools 然後編輯個 "system" 儲存池以設置一個通用嘅儲存池比全部使用者用。

![](../../img/started/README-HK/sp.png)



#### Deploy 喺一大堆機上面

你可以直接編輯個設定檔，然後將設定檔寫入映像檔入面部署。詳情參閱以下檔案：

```
src/system/storage.json.example
```

將個 storage.json.example 重新命名到 storage.json 然後啟動 arozos。之後你設定嘅儲存池就會被系統掛載。




## ArOZ JavaScript Gateway Interface / 插件載入器

ArOZ AGAI （或 AGI）是一個可編程的 JavaScript 界面。你可以用佢嚟幫呢套系統寫插件。你個插件會跟據 "init.agi" 檔案入面嘅設定值啟動。詳情請參閱相關說明文件： ![AJGI Documentation](https://github.com/tobychui/arozos/blob/master/src/AGI%20Documentation.md).

## 其他資源

如果你搵緊其他可以裝嘅 WebApp （可透過系統設定安裝）或 子服務 （需要透過 SSH 登入到後台安裝，你可以去睇睇呢個 list
https://github.com/aroz-online/WebApp-and-Subservice-Index

## 社群 / Q&A

有問題？嚟  [Telegram](https://t.me/ArOZBeta) 搵我啦！ 我地歡迎所有意見同埋問題。

如果你已經用緊 ArozOS，可以過嚟呢度開個 post 話我知架！

https://github.com/tobychui/arozos/issues/50

## 授權

CopyRight tobychui 2016 - 2021

No limit for personal and educational usage. For other use case, please contact me via email or telegram.

## 贊助開發

我依家係為興趣而唔係全職咁寫呢套系統，所以暫時唔收贊助。