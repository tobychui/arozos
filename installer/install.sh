#!/bin/bash
cat << "EOF"
    _               ___  ___   ___   __  
   /_\  _ _ ___ ___/ _ \/ __| |_  ) /  \ 
  / _ \| '_/ _ \_ / (_) \__ \  / / | () |
 /_/ \_\_| \___/__|\___/|___/ /___(_)__/ 
                                         
	----- ArozOS 2.0 Installer -----	
	
EOF

echo ""

# Prompt the user to agree to the GPLv3 license
read -p "Do you agree to the terms of the GPLv3 license? (y/n) " agree

if [[ $agree != "y" ]]; then
  echo "You must agree to the GPLv3 license to use ArozOS."
  exit 1
fi

HOMEDIR=$( getent passwd "$USER" | cut -d: -f6 )

if [ $USER = root ] ; then
  echo "You are root";
  sudo=""
else
  sudo="sudo "
fi


# Create the required folder structure to hold the installation
cd ~/ || exit
mkdir arozos
cd arozos || exit

# Run apt-updates
${sudo}apt-get update
${sudo}apt-get install ffmpeg net-tools -y

# Determine the CPU architecture of the host
if [[ $(uname -m) == "x86_64" ]]; then
  arch="amd64"
elif [[ $(uname -m) == "aarch64" ]]; then
  arch="arm64"
elif [[ $(uname -m) == "armv"* ]]; then
  arch="arm"
else
  read -p "Enter the target architecture (e.g. darwin_amd64, windows_amd64): " arch
fi

# Download the corresponding executable from Github
if [[ $arch == "amd64" ]]; then
  download_url="https://github.com/tobychui/arozos/releases/latest/download/arozos_linux_amd64"
elif [[ $arch == "arm64" ]]; then
  download_url="https://github.com/tobychui/arozos/releases/latest/download/arozos_linux_arm64"
elif [[ $arch == "arm" ]]; then
  download_url="https://github.com/tobychui/arozos/releases/latest/download/arozos_linux_arm"
elif [[ $arch == "windows_amd64" ]]; then
  download_url="https://github.com/tobychui/arozos/releases/latest/download/arozos_windows_amd64.exe"
elif [[ $arch == "windows_arm64" ]]; then
  download_url="https://github.com/tobychui/arozos/releases/latest/download/arozos_windows_arm64.exe"
else
  download_url="https://github.com/tobychui/arozos/releases/latest/download/arozos_${arch}"
fi

# Download the arozos binary
echo "Downloading Arozos from ${download_url} ..."
wget -O arozos "${download_url}"
chmod +x arozos

# Download the webpack
wget -O web.tar.gz "https://github.com/tobychui/arozos/releases/latest/download/web.tar.gz"

# Check if the platform is supported for the launcher
if [[ "$arch" == "amd64" || "$arch" == "arm" || "$arch" == "arm64" ]]; then
  # Ask if the user wants to install the launcher
  read -p "Do you want to install the Arozos launcher for OTA updates? [Y/n] " answer
  case ${answer:0:1} in
      y|Y )
          # Download the appropriate binary
          echo "Downloading Arozos launcher from https://github.com/aroz-online/launcher/releases/latest/ ..."
          case "$arch" in
              amd64)
                  launcher_url="https://github.com/aroz-online/launcher/releases/latest/download/launcher_linux_amd64"
                  ;;
              arm)
                  launcher_url="https://github.com/aroz-online/launcher/releases/latest/download/launcher_linux_arm"
                  ;;
              arm64)
                  launcher_url="https://github.com/aroz-online/launcher/releases/latest/download/launcher_linux_arm64"
                  ;;
              *)
                  echo "Unsupported architecture for Arozos launcher"
                  ;;
          esac
          if [[ -n "$launcher_url" ]]; then
              wget -O launcher "${launcher_url}"
              chmod +x launcher
              echo "Arozos launcher has been installed successfully!"
          fi
          ;;
      * )
          echo "Arozos launcher installation skipped"
          ;;
  esac
fi

# Ask for setup name
read -p "Enter setup name (default: aroz): " arozosname
arozosname=${arozosname:-aroz}

# Ask for preferred listening port
read -p "Enter preferred listening port (default: 8080): " arozport
arozport=${arozport:-8080}

# Check if launcher exists
if [[ -f "./launcher" ]]; then
  # Create start.sh with launcher command
  echo "#!/bin/bash" > start.sh
  echo "${sudo}./launcher -port=$arozport -hostname=\"$arozosname\"" >> start.sh
else
  # Create start.sh with arozos command
  echo "#!/bin/bash" > start.sh
  echo "${sudo}arozos -port=$arozport -hostname=\"$arozosname\"" >> start.sh
fi

# Make start.sh executable
chmod +x start.sh

echo "Setup name: $arozosname"
echo "Preferred listening port: $arozport"
echo "start.sh created successfully!"

# Ask if user wants to install ArozOS to systemd
if [[ $(uname) == "Linux" ]]; then
    read -p "Do you want to install ArozOS to systemd service? (y/n)" -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # Get current user
        CURRENT_USER=$(whoami)
		
		${sudo}touch /etc/systemd/system/arozos.service
		${sudo}chmod 777 /etc/systemd/system/arozos.service
        # Create systemd service file
        cat <<EOF > /etc/systemd/system/arozos.service
[Unit]
Description=ArozOS Cloud Service
After=systemd-networkd-wait-online.service
Wants=systemd-networkd-wait-online.service

[Service]
Type=simple
ExecStartPre=/bin/sleep 10
WorkingDirectory=/${HOMEDIR}/${CURRENT_USER}/arozos/
ExecStart=/bin/bash /${HOMEDIR}/${CURRENT_USER}/arozos/start.sh

Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
		${sudo}chmod 644 /etc/systemd/system/arozos.service
		
        # Reload systemd daemon and enable service
        ${sudo}systemctl daemon-reload
        ${sudo}systemctl enable arozos.service
		${sudo}systemctl start arozos.service
        echo "ArozOS installation completed!"
		ip_address=$(hostname -I | awk '{print $1}')
		echo "Please continue the system setup at http://$ip_address:$arozport/"
    fi
else
	echo "ArozOS installation completed! Execute start.sh to startup your ArozOS system."
fi


