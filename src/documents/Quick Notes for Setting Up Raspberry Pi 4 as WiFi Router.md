# Quick Notes for Setting Up Raspberry Pi 4 as WiFi Router

This is just a quick notes for myself on how to setup a Raspberry Pi 4 with Mercury AC650M USB WiFi Adapter

### Problem

The current setup of the system make use of a ARGON ONE metal case which, will make the build in WiFi adapter really hard to use as an AP. Hence, we need to setup an external WiFi adapter for this purpose.

### Required Parts

- Mercury USB WiFi Adapter AC650M (Dual baud 5G no driver version)
- ARGON ONE metal case
- Raspberry Pi 4B
- 64GB Micro SD card



### Installation

1. Install Raspberry Pi OS and run apt-updates

2. Download the driver for RTL8821CU

   ```
   mkdir -p ~/build
   cd ~/build
   git clone https://github.com/brektrou/rtl8821CU.git
   ```

   

3. Install DKMS

   ```
   sudo apt-get install dkms
   ```

   

4. Upgrade apt

   ```
   sudo apt update -y
   sudo apt upgrade -y
   ```

5. Install bc and reboot

   ```
   sudo apt-get install bc
   sudo reboot
   ```

6. Edit the Make file of the downloaded repo and change these two lines as follows

   ```
   CONFIG_PLATFORM_I386_PC = y
   CONFIG_PLATFORM_ARM_RPI = n
   ```

   to

   ```
   CONFIG_PLATFORM_I386_PC = n
   CONFIG_PLATFORM_ARM_RPI = y
   ```

7. Fix the compile flag on ARM processor

   ```
   sudo cp /lib/modules/$(uname -r)/build/arch/arm/Makefile /lib/modules/$(uname -r)/build/arch/arm/Makefile.$(date +%Y%m%d%H%M)
   sudo sed -i 's/-msoft-float//' /lib/modules/$(uname -r)/build/arch/arm/Makefile
   sudo ln -s /lib/modules/$(uname -r)/build/arch/arm /lib/modules/$(uname -r)/build/arch/armv7l
   ```

8. Build via DKMS

   ```
   sudo ./dkms-install.sh
   ```

   

9. Plug your USB-wifi-adapter into your PC

10. If wifi can be detected, congratulations. If not, maybe you need to switch your device usb mode by the following steps in terminal:

    1. Find your usb-wifi-adapter device ID, like "0bda:1a2b", by type: ```lsusb```

    2. Need install `usb_modeswitch` 

       ```
       sudo usb_modeswitch -KW -v 0bda -p 1a2b
       systemctl start bluetooth.service
       ```

11.  Edit `usb_modeswitch` rules:

    ```
    udo nano /lib/udev/rules.d/40-usb_modeswitch.rules
    ```

12. Append before the end line `LABEL="modeswitch_rules_end"` the following:

    ```
    # Realtek 8211CU Wifi AC USB
    ATTR{idVendor}=="0bda", ATTR{idProduct}=="1a2b", RUN+="/usr/sbin/usb_modeswitch -K -v 0bda -p 1a2b"
    ```

    







