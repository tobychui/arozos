#!/bin/bash
cat << "EOF"
    _               ___  ___   ___   __  
   /_\  _ _ ___ ___/ _ \/ __| |_  ) /  \ 
  / _ \| '_/ _ \_ / (_) \__ \  / / | () |
 /_/ \_\_| \___/__|\___/|___/ /___(_)__/ 
                                         
	----- ArozOS 2.0 Uninstall -----	
	
EOF

# Ask user to confirm uninstall
read -p "Are you sure you want to uninstall Arozos? This will delete all data in the arozos directory. (y/n) " choice
case "$choice" in
  y|Y )
	# Stop the ArozOS service if it is running
	if [[ $(uname) == "Linux" ]]; then
		if systemctl status arozos >/dev/null 2>&1; then
			sudo systemctl stop arozos
			echo "Stopped ArozOS service."
		fi
	fi

	# Remove the ArozOS folder
	cd ~/ || exit
	if [[ -d "arozos" ]]; then
		sudo rm -rf arozos
		echo "Removed ArozOS folder."
	fi

	# Remove the ArozOS service file
	if [[ $(uname) == "Linux" ]]; then
		if [[ -f "/etc/systemd/system/arozos.service" ]]; then
			sudo rm /etc/systemd/system/arozos.service
			echo "Removed ArozOS systemd service file."
		fi
	fi
	sudo systemctl daemon-reload
	echo "ArozOS has been uninstalled successfully!"
	;;
  n|N ) 
    echo "Uninstall cancelled"
    ;;
  * ) 
    echo "Invalid input, uninstall cancelled"
    ;;
esac
