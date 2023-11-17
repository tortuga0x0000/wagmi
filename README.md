# Telegram crypto group assistant
Telegram bot which enhance your group research about a coin with AI.

## Development

### Create a local mongo database

```bash
# Warning: we assume that the host is secured enough to expose the container on the port 27017
docker run -it -d --name wagmi-mongo -p 27017:27017 --restart=unless-stopped -e MONGO_INITDB_ROOT_USERNAME=root -e MONGO_INITDB_ROOT_PASSWORD=pwd mongo

docker exec -it wagmi-mongo mongosh -u root -p pwd --authenticationDatabase admin
```
Once in the mongo shell, create the wagmi user which will be in charge of the wagmi database. For security reason, root user is just used via mongoshell for maintenance.
```js 
use wagmi

db.createUser({
    user: "wagmi",
    pwd: "password",
    roles: [ "readWrite", "dbAdmin" ]
})
```

### Start dev environnement

```bash
$npm i
$npm run dev
$npm run start
```

## Deployment

- requirements: this early stage setup assumes that you have a service on your server called `wagmi.service` with the following config.

```conf
[Unit]
Description=Telegram bot which aggregate information from a group and use AI to enhance this informations.

[Service]
Environment=NODE_ENV=production
ExecStart=/home/ubuntu/.nvm/versions/node/v20.9.0/bin/node /home/ubuntu/runtime/wagmi/index.js
Restart=always
# Restart service after 10 seconds if node service crashes
RestartSec=10
# Output to syslog
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=wagmi
User=ubuntu

[Install]
WantedBy=multi-user.target
```

- copy the deploy.sh script on your server and run it. It will download the master branch, compile it and restart the service.

```bash
$npm run dev
```

### Utility commands

To dump the database
```bash
docker exec -it wagmi-mongo mongodump -u wagmi -p pwd --authenticationDatabase wagmi --db wagmi --out dump

docker cp wagmi-mongo:/dump .
```

To restore a backup
```bash
docker cp dump wagmi-mongo:/

docker exec wagmi-mongo mongorestore -u wagmi -p pwd --authenticationDatabase wagmi dump --drop
```

### Specific config for EC2

If you want to monitor the Mongo DB from your local machine, you need to open the mongo port on the EC2 security group.

Open the distant port on the EC2 security group applied to the instance:
- click on "Add a rule"
- set "Custom TCP"
- set port to 27017
- set from my IP (preferably set a VPN IP)