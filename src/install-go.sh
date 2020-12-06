#/bin/bash
echo "Input the go arch to install (arm/arm64/amd64)"
read -p "Architecture: " arch
if [ "$arch" = "arm" ]; then
   echo "Installing arm version of go"
   wget https://golang.org/dl/go1.15.3.linux-armv6l.tar.gz
fi

if [ "$arch" = "arm64" ]; then
   echo "Installing arm64 version of go"
   wget https://golang.org/dl/go1.15.3.linux-arm64.tar.gz
fi

if [ "$arch" = "amd64" ]; then
   echo "Installing amd64 version of go"
   wget https://golang.org/dl/go1.15.3.linux-amd64.tar.gz
fi

sudo tar -C /usr/local -xzf go*
echo "ADD THE FOLLOWING LINE TO YOUR ~/.bashrc FILE:"
echo 'export PATH=$PATH:/usr/local/go/bin'

echo "Install Complted"
