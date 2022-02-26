#!/bin/bash

# Automatic install script for ArozOS - by tobychui
# For internal use only, All Right Reserved
echo "[ArozOS Installer]"
echo "Updating apt"
sudo apt upgrade -y
sudo apt-get update -y
sudo apt-get install ffmpeg samba git net-tools -y

echo "Cloning ArozOS from source"
git clone https://github.com/tobychui/arozos

echo "Installing Golang"
arch=$(uname -m)
gover="1.17.6"
if [[ $arch == x86_64* ]]; then
    echo "Selecting x64 Architecture"
    wget https://golang.org/dl/go$gover.linux-amd64.tar.gz
elif  [[ $arch == arm* ]]; then
    echo "Selecting ARM Architecture"
    wget https://golang.org/dl/go$gover.linux-armv6l.tar.gz
elif  [[ $arch == "aarch64" ]]; then
    echo "Selecting ARM64 Architecture"
    wget https://golang.org/dl/go$gover.linux-arm64.tar.gz
elif [[ $arch == "unknown" ]]; then
    echo "Unknown CPU arch. Please enter CPU architecture manually (arm/arm64/amd64)"
    read -p "Architecture: " arch
    if [ "$arch" = "arm" ]; then
        echo "Installing arm version of go"
        wget https://golang.org/dl/go$gover.linux-armv6l.tar.gz
    fi
    if [ "$arch" = "arm64" ]; then
	echo "Installing arm64 version of go"
	wget https://golang.org/dl/go$gover.linux-arm64.tar.gz
    fi

    if [ "$arch" = "amd64" ]; then
	echo "Installing amd64 version of go"
	wget https://golang.org/dl/go$gover.linux-amd64.tar.gz
    fi
fi
sudo tar -C /usr/local -xzf go*
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
PATH=$PATH:/usr/local/go/bin

echo "Building ArozOS"
cd arozos
sudo chmod 777 -R ./
cd src
go mod tidy
go build

echo "Setting up system services"
sudo systemctl enable systemd-networkd.service systemd-networkd-wait-online.service
cd /etc/systemd/system/

printf "[Unit]\nDescription=ArozOS Cloud Service\nAfter=systemd-networkd-wait-online.service\nWants=systemd-networkd-wait-online.service\n\n[Service]\nType=simple\nExecStartPre=/bin/sleep 10\nWorkingDirectory=/home/$USER/arozos/src/\nExecStart=/bin/bash /home/$USER/arozos/src/start.sh\n\nRestart=always\nRestartSec=10\n\n[Install]\nWantedBy=multi-user.target" | sudo tee -a ./arozos.service

echo "Registering systemctl service"
sudo systemctl start arozos.service

echo "Starting arozos"
sudo systemctl enable arozos.service

thisip=$(hostname -I | cut -d' ' -f1)
echo "Installation completed. Visit ArozOS web UI with http://$thisip:8080"
