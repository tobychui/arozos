# 简介

arozos是一种通用的跨平台Web桌面操作系统，旨在使用JavaScript（ArOZ网关接口），反向代理（子服务）或Docker，实现用户友好，直观且具有高度可扩展性。

该平台专为Raspberry Pi设计，也可以在功能有限的其他ARM SBC甚至Windows / macOS上运行。

## 基本功能
arozos的基本功能包括

* 用户认证和登录
* 权限管理
* 存储配额管理
* 磁盘管理和存储池
* 网络桌面环境
* Fullfledge文件系统资源管理器
* 用于在系统文件中打开的可扩展WebApp
* 虚拟化文件路径和存储池
* JavaScript虚拟机，用于在主机硬件（ArOZ网关接口，AGI）上执行WebApp请求
* 自动反向代理服务器
* 用于外部Web服务的RESTFUL API
* 还有很多不一一列举

# 备注

## 早期版本ArOZ

早期版本的arozos名为“ArOZ Online System”或“ArOZ Online Beta”（AOB）。有关此系统Beta版的信息和文档，请阅读“ArOZ在线分布式云系统文档”。

您可以通过识别系统的编程语言来对这两个系统之间的差异进行分类。


| 版本 | 程式语言| 文件扩展名 |
| :----: | :------: | :--------: |
| ArOZ Online Beta | PHP5 / PHP7 | .php |
| ArOZ OS (ArOZ Online 1.0)	 | Go | .go |

* 出于简化和易于阅读的原因,ArOZ OS在当前文档中被称为“arozos”。

# 介绍

## 项目目的

许多现成的云服务和基础架构仅用于商业或商业目的。对于非营利性或通用云平台，专为即插即用开发提供的选择有限。

该项目的beta短语旨在在软件和硬件方面提供低成本的个人和私有云体系结构，并以较高的可伸缩性和可靠性进行分发，以部署关键系统。

在此系统的1.0版本中，系统架构已进行了重新设计，以适应更通用的云计算，包括快速系统部署，服务绑定，并允许一般用户通过更友好的Web桌面界面使用云计算技术。

------

## 命名方案

### 阶段命名

ArOZ Online System（原名“Automated Remote Operating Zigzagger”，Zigzagger的意思是将其很好地连结在一起）是一个平台，旨在在Raspberry Pi Model B上使用外部硬盘存储多媒体文件，从而提供“媒体中心”般的用户体验，并允许在局域网环境中使用媒体。后来，越来越多的与云相关的功能被添加到系统中，以更好地增强系统的可用性，包括但不限于Web桌面环境，集群设置和通信管道，分布式文件系统以及系统可编程模块。这些模块和子系统为云平台增加了更多功能。

The Beta system (ArOZ Online Beta)是提供上述所有功能并通过桥接到底层Linux文件系统来提供类似于Web桌面的环境的系统。为用户提供强大的云桌面环境，使其可以与任何移动或桌面设备一起使用，而不受诸如个人智能手机或笔记本电脑之类的指定终端设备的限制。

1.0版本（arozos）是一个完全基于Beta阶段需求发现过程重写的系统。Beta上的大多数众所周知的功能都已使用效率更高的Go（而不是PHP）重写。无需升级硬件即可从Raspberry Pis等Linux SBC中获得更多性能提升。

### 版本命名

ArOZ系列软件的版本系统如下：

| Version Name | Development Date |	Systems (Language) |
| :---: | :----- : | :---: |
| ArOZ (Alpha) | Early 2014 | Windows 7 (VB.net) |
| ArOZ Beta	Late | 2014	| Windows 7 (VB.net) |
| ArOZ Omega | Early 2015 | Windows 7(VB.net) |
| ArOZ Online Alpha | Late 2015 - Early 2016 | Windows 7 (WAMP + PHP 5) |
| ArOZ Online Beta | 2016 - 2020 | Windows / Linux (Apache + PHP 7) |
| ArOZ OS |2020 - Now | Windows / Linux / Mac OS (Go 1.14+) |

--------

## 系统使用情况

ArOZ Online System可以在便携式设备，微型NAS系统或服务器级计算机上运行。因此，该系统将适合多种不同用途的需求，包括便携式工作站，媒体转换或使用，数据备份和还原等。

Arozo为业务部门提供了更通用的用途，包括功能齐全的身份验证系统，用户权限和分组系统，内部反向代理服务以及存储池管理。允许将系统用于部署需要用户管理和用户权限管理的Web平台。

模块化WebApp系统设计还增强了权限系统，使得云计算过程和web服务更加安全。

## 术语

在本文档中，以下术语将用于描述此系统中提供的内容和功能。

| 术语 | 说明 |
| :----: | :----: |
| Arozos / ArOZ操作系统 | 本文档中讨论的云系统 |
| 网络应用 | 作为/ web目录中的文件夹安装在arozos上的Web应用程序 |
| 子服务 | Web应用程序，作为单独的二进制文件安装在arozos上，位于/ subservice目录下的文件夹中 |
| Web桌面界面/ VDI模式 | 虚拟桌面界面（模式）。用户通过其基于Web的桌面用户界面与arozos进行交互的模式 |
| 清单选单 | 用于在VDI和移动界面上启动应用程序的应用程序启动菜单|
| FloatWindow（fw) | 位于基于Web的桌面界面上的类似于窗口的iframe，用户可以拖动，调整大小和隐藏 |
| 功能（最终）栏 | 用于显示用户打开的Web应用程序的Web桌面界面的底部栏，或将显示用户打开Web应用程序的移动桌面模式的侧边栏 |
| 状态栏 | Web桌面界面上的顶部栏，用于显示主机名，当前日期时间和用于显示快捷方式的内容按钮 |
| Arozfs / aroz虚拟文件系统 | 由arozos模拟的虚拟文件系统 |

-----------

# 系统要求

## 硬件

最低配置

1Ghz CPU（ARMv6 / 7，ARM64或AMD64），512MB内存，8GB存储空间

推荐配置

2Ghz以上 CPU（ARM7，ARM64或AMD64），2GB内存，32GB存储空间

系统测试基于：

* Raspberry Pi 3B+ 带有Raspberry Pi OS
* Raspberry Pi Zero W w / Raspberry Pi操作系统
* 基于Raspberry Pi OS的Raspberry Pi 4B+（1GB / 2GB / 4GB版本）
* 基于Armbian Buster的Orange Pi Zero Plug （H5 CPU版）
* 基于Debian Buster的AMD64 ThinClient
* Ryzen 5 w / Windows 10
* 基于Windows 7的英特尔奔腾

----

##软件

操作系统：

Raspberry Pi OS / Debian Buster，（Windows 7+和macOS Catalina +的受限功能）

基础组件（必装）：

Wpa_supplicant或nmcli，网络工具（ifconfig），FFmpeg

-----

## 客户端/浏览器

macOS High Sierra或更高版本/ Windows 7或更高版本上的任何现代浏览器（Chrome / Firefox / Safari（未测试）/ Edge的最新版本）

----

## 网络

网络环境：

网路速度至少为10Mbps（建议100Mbps以上），WiFi 2.4 / 5GHz或有线网络

----

# 安装

## 对于Raspberry Pi（对于Raspberry Pi 4B+）

如果您使用Raspberry Pi作为主机，则可以下载其中一个镜像并将该镜像刷入SD卡。您会在“网络邻居”中找到一个名为“ArozOS（ARxxx）”的新网络设备。双击该图标，您将被重定向到系统Web设置界面。

您可以在Github存储库的README文件中找到图像的链接。

[arozos](https://github.com/tobychui/arozos)

您可以使用7zip解压缩镜像获取.img文件。如果你没有的话，可以在这里找到。

---

## 对于其他ARM SBC（例如Orange Pi / Banana Pi / Friendly ARM's Pis）

从“release”下载正确的二进制文件，然后将二进制文件与“/ src”中的“web”和“system”文件夹一起上传。上传后，您应具有以下文件结构
```
$ ls
arozos_linux_arm64  web  system
```
通过运行`sudo ./arozos_linux_arm64`来启动二进制文件 (如果你是管理员，可不使用`sudo`命令)

----

## 对于使用64位CPU的PC

在您的PC上安装Debian Buster系统，并下载二进制文件`arozos_linux_amd64`、web和系统文件夹。当您下载好所有的东西，将看到类似这样的内容。
```
$ ls
arozos_linux_amd64  web  system
```
运行`./arozos_linux_amd64`启动二进制文件

----

# 从源构建

## Linux（Debian）/ Darwin（MacOS）

要从源代码构建，请安装`Git`和`Go`并按照以下说明进行操作。
```
git clone https://github.com/tobychui/arozos arozos
cd ./arozos/src
go build
```
Linux所需的软件包

ArozOS将需要这些额外的软件包才能正常运行

1. ffmpeg
2. wpa_supplicant或nmcli（如果有wlan接口）
----

## Windows

如果要在Windows上进行部署，则需要将ffmpeg添加到％PATH％环境变量中。

可以按照以下构建说明在Windows主机上构建并运行该系统
```
# Download the whole repo as zip and cd into it
cd .\arozos\src\
go build
arozos.exe
```
但是，并非所有功能都可用于Windows（例如WiFi / Samba）

----

# 系统总览

## 资料夹结构

Arozos的文件夹结构包含三个主要组件。文件夹结构如下所示。


| 结构名称 | 位置 | 目的 |
| :----: | :----: | :----: |
| Web | ./web | 用于存储WebApp脚本的目录（包括系统GUI元素） |
| System |	./system | 用于存储系统文件夹的目录。数据库，模板和其他重要文件存储在这里。这不应通过存储池处理程序公开。 |
| Subservice | ./subservice | 安装到arozos的子服务。允许arozos对这些Web服务二进制文件执行反向代理访问。 |
| Arozos Binary | ./arozos (or arozos.exe) | Arozos系统主要逻辑的可执行文件 |

## 应用结构

随着arozos逐渐脱离PHP，无法将模块或插件动态添加到预编译的二进制文件中。因此，有两种新方法可将插件添加到系统中。

1. WebApps-基本的WebApp，主要逻辑由JavaScript和RESTFUL处理
2. 子服务-高级Web应用程序，其中应用程序需要对基础操作系统的复杂访问

在以下各节中，将介绍方法的结构。有关为arozos开发插件的详细信息，请参阅WebApp和Subservice部分。

## WebApp结构

Arozos Web应用程序（或WebApps）存储在./web文件夹下。每个文件夹包含可通过arozos内部Web服务器提供的html，JavaScript和CSS文件列表。WebApp的通用文件夹结构应包含以下文件。


| 文档名称 |	目的	| 必要的 |
|:----: | :----: | :----: |
| init.agi | 定义WebApp启动属性 | 是 |
| index.html | 服务的WebApp索引 | 是 |
| */icon.png | 该模块的图标 | 是 |
| */desktop_icon.png | 显示为桌面快捷方式的图标 | 不是 |
| Embedded.html | 嵌入式模式用户界面 | 视情况而定 |
| floatWindow.html | 浮动窗口模式用户界面 | 视情况而定 |
| manifest.json | 支持PWA所需的清单 | 推荐 |

-----

## 子服务结构

子服务是Web服务器二进制文件，存储在./subservice文件夹下，并且提供需要更高级别的复杂性的服务。基本子服务包含以下文件结构。

| 文档名称 | 目的 | 强制性的 |
| :----: | :----: | :----: |
| {subservicename}{platform}_{architecture} | 子服务的二进制文件 | 是 |
| .disabled	| 在启动时禁用此子服务的标志	 | 不是 |
| .startscript | 标志加载启动脚本进行注册，而不是二进制文件本身 | 不是 |
| moduleInfo.json | 模块信息JSON	| 视情况而定 |
| start.sh (or start.bat) | 替换子服务启动参数中的-info标志的启动脚本 | 视情况而定 |

根据平台和子服务名称的不同，二进制名称可能会有所不同。

例如，这是一个名为“demo”的子服务，具有支持linux（arm，arm64和amd64），MacOS（darwin）和Windows的支持。在Windows的“文件资源管理器”下，其二进制文件将如下所示。

在某些情况下，使用粘合脚本时，可能还会有一些bash文件或额外的二进制文件。在这种情况下，您需要在启动arozos core之前为这些文件分配适当的权限。拒绝执行子服务中的文件的权限将导致启动arozos系统失败。

# 系统抽象结构

arozos系统由许多复杂的抽象层组成，用于在任何云平台或主机设备上模拟操作系统。下图提供了系统抽象结构的抽象视图。

简单来说，arozos结构主要由以下模块组成

1. 认证系统
2. 权限路由器
3. 反向代理服务器
4. ArOZ网关接口（AGI）JavaScript解释器
5. 网络服务（SSDP / MDNS / UPNP）
6. 权限组系统
7. 储存配额管理系统
8. 存储池管理系统（包括路径虚拟化）

# 用户界面结构

在arozos中，Beta中引入的原始“网格界面”已被删除，因为大多数用户将直接启动其桌面界面。为此，引入了新的接口来代替网格接口作为移动设备的默认接口模块。在arozos UI实现中，系统默认支持三种UI。

1. Web桌面界面
2. 移动桌面界面
3. 接口模块接口

对于Aroz的Beta版，界面包括

1. 网格菜单界面
2. Web桌面界面
3. 多系统启动接口（MSBI）

## Web桌面界面

arozos Web桌面界面是对原始桌面界面的完全重写，并且与Beta桌面相比提供了更好的用户体验。

Arozos Web桌面界面预览，在v1.106上捕获

ArOZ在线Beta Web桌面界面，在Beta LTS上捕获

对于基本用法，Web桌面支持创建新文件夹，通过拖放上传文件，双击打开文件，文件夹或应用程序快捷方式等。有关更多信息，请参见桌面。

在arozos 1.0中，添加了一个顶部菜单以显示时间，音量信息和Ubuntu 20.04，还提供了一个通知栏以及一个快速下拉功能菜单，用于访问快速功能，包括全屏切换，系统设置和用户注销。

-----

## 移动桌面界面

移动桌面界面最初是在arozos 1.105中引入的，用于支持垂直屏幕（大多数移动设备）。在此模式下，floatWindow仍受有限功能的支持。列表菜单和工具栏也被边栏代替。但是，该界面确实允许多处理，就像标准的桌面界面一样。

------

## 网格菜单界面

Grid Menu界面是已弃用的界面，专为ArOZ Online Beta（AOB）用户设计，可在移动设备上使用系统。它也是ArOZ在线系统的第一个界面，提供对一个界面内所有系统模块的访问。

此接口已弃用，在arozos 1.0上不再可用。此功能已由移动桌面界面上的List Men取代，并且在arozos 1.0中没有启用此功能的方法。

----

## IMUS多系统启动界面（MSBI / IMSB）

MSBI是使用类似于bootoz的系统之类的引导程序将服务绑定在一起的原始方法。它提供了一个非常基本的门户，用于将用户重定向到同一主机环境中的不同网络服务。

例如，可以使用MSBI工具作为主路由器，在同一台计算机上安装多个ArOZ Online Beta。

该接口已被弃用，并被子服务模块（功能性）和权限组接口模块设置（选择性）取代。有关更多详细信息，请参见“接口模块”部分。

## 初次启动

如果您是第一次启动系统，您将在控制台中看到以下消息，表明您的设置已完成并且正在运行。以下是Windows主机上的v0.1.109版本的示例

```
2021/01/06 12:58:31 ArozOS(C) 2020 IMUSLAB.INC.
2021/01/06 12:58:31 ArozOS development Revision 0.1.109
2021/01/06 12:58:31 Key-value Database Service Started: system/ao.db
2021/01/06 12:58:31 New authentication session key generated
2021/01/06 12:58:31 Key-value Database Service Started: files/aofs.db
2021/01/06 12:58:32 Key-value Database Service Started: tmp/aofs.db
2021/01/06 12:58:32 Failed to create system handler for Storage 1
2021/01/06 12:58:32 Unsupported platform
2021/01/06 12:58:32 Failed to create system handler for Storage 2
2021/01/06 12:58:32 Unsupported platform
2021/01/06 12:58:32 Failed to create system handler for Storage 3
2021/01/06 12:58:32 Mount point not exists!
2021/01/06 12:58:32 Failed to create system handler for Storage 4
2021/01/06 12:58:32 Mount point not exists!
2021/01/06 12:58:32 Key-value Database Service Started: web/aofs.db
2021/01/06 12:58:32 Web Mounted as web:/ for group administrator
2021/01/06 12:58:32 Failed to create system handler for Test
2021/01/06 12:58:32 Mount point not exists!
2021/01/06 12:58:33 ArozOS Neighbour Scanning Started
2021/01/06 12:58:33 Web server listening at :8080
```

对于首次启动，我们建议使用sudo权限运行该程序，以便使用apt-get安装它需要的所有依赖项

一旦看到控制台停止打印新文本，您现在可以在ArozOS主机上创建您的第一个帐户。

-----

# 连接到Web UI

## Windows网络邻居方法

如果您使用Windows作为主要系统，则您的网上邻居页面上将弹出以下设备。

双击该图标，您将被重定向到ArozOZ Web UI主页。

-----

## 路由器IP检查

如果您不知道主机的IP地址，请从NAT网关路由器检查主机的IP地址。通常在DHCP->客户端列表->您的主机名和LAN IP地址下。

-----

## SSH IP检查

如果您已经使用SSH连接到主机，请使用sudo ifconfig来查看其使用的IP地址。在大多数情况下，您将在eth0下找到您的地址。在下面的示例中，它是192.168.0.128。

----

## 设置第一个用户帐户

重定向到Web UI后，使用新的用户名和密码创建帐户。在用户组选项下选择“管理员”，然后继续。

----

## 使用您的新用户名和密码登录

创建帐户后，您现在可以使用刚才输入的用户名和密码登录系统。请注意，这是一个独立的系统，无法像其他云服务一样使用电子邮件/电话SMS服务来恢复密码。所以不要忘记您的管理员密码

# 启动选项和标志

ArozOS提供了许多在多种不同条件下使用的启动选项。

要列出标志及其用法，请使用

```
./arozos -h
```

这是ArozOS 1.109支持的启动标志的列表

```
Usage of arozos.exe:
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

## 例子

以下是在不同情况下使用arozos的一些示例

-----

### 基本

将端口更改为端口80

将主机名更改为“我的网络磁盘”

```
./arozos -port 80 -hostname "My Network Disk"
```

### 启用TLS支持（又名HTTPS）

* 启用TLS
* 将端口更改为443
* 从文件加载证书和密钥

```
./arozos -port 443 -tls=true -cert "mycert.crt" -key "mykey.key"
```

----

### 从外部访问

用例：您有一个具有公共IP地址的网关NAT路由器，并且想要使用公共IP地址访问家外的ArozOS主机

* 启用UPNP
* 不要使用端口80
* 禁用IP解析器（因为它将始终是您的NAT路由器地址）

```
./arozos -allow_upnp=true -port 8123 -disable_ip_resolver=true
```

此操作将要求您的路由器支持UPnP功能。如果不是，请跳过“allow-upnp”标志，并在路由器中转发设置端口。

----

### 在Cloud VM上部署

用例：在AWS，Linode / Ramnode或Azure上部署

* 禁用网络发现功能（因为它仍然在虚拟网络中）
* 禁用软件包安装以防止更改到生产环境
* 禁用目录列表，以便用户无法扫描Web服务器中的文件
* 禁用硬件管理，因为VM中没有真正的硬件
* 禁用IP解析器（如果您在反向代理下运行，这在生产环境中很常见）

```
./arozos -allow_mdns=false -allow_pkg_install=false -allow_ssdp=false -dir_list=false -enable_hwman=false -disable_ip_resolve=true
```

-----

### 在超低内存单板计算机上部署

用例：在只有512MB甚至256MB RAM的Pi Zero w，ZeroPi或Orange Pi Zero上进行部署

* 降低IO操作缓冲区（可选）
* 将上传缓冲内存从25MB降低到10MB
* 在内存不足的环境（<2GB RAM）下，ArozOS将自动切换到“内存不足上传模式”，在该模式下，它将使用基于WebSocket模块的上传而不是表单发布上传方式。

```
./arozos -iobuf 512 -upload_buf 10
```

----

### 在其启动盘只有不到16GB空间的瘦客户机上进行部署

用例：第二手瘦客户端作为NAS，预算非常紧凑的个人云存储构建

假设您插入了一个外部存储设备（例如，外部SSD）并将其安装为/media/storage

* 将用户根目录和tmp文件夹移出安装磁盘
* 将最大文件上传大小从8GB减少到25MB

```
./arozos -tmp "/media/storage/" -root "./media/storage/files/" -max_upload_size 25
```

----

### 部署为自动化服务/服务器面板

用例：气象站，数字广告牌和其他需要自动登录的物联网设备

* 启用自动登录

```
./arozos -allow_autologin=true
```

并遵循“自动登录模式”的“系统设置”选项卡中的设置

-----