rm -rf ~/wagmi
mkdir wagmi
git clone https://github.com/tortuga0x0000/wagmi.git wagmi
cd wagmi
git checkout master
npm i
npm run build
sudo systemctl stop wagmi.service
cp ./dist/* ../runtime/wagmi
cp -r ./node_modules ../runtime/wagmi
sudo systemctl start wagmi.service
