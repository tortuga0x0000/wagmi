# clone repo
rm -rf ~/jared-bot
mkdir jared-bot
git clone https://github.com/dagatsoin/tg-ticker-listing.git jared-bot
cd jared-bot
npm i
npm run build
cp .dist/* ../runtime/jared-bot
cd ../runtime/jared-bot
node index.js
