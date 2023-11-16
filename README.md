# Telegram history counter
A bot which list any ticket found in a channel to a Google Sheet file.

## Development

`npm run dev`

### Create a local mongo database

```bash
# Warning: we assume that the host is secured enough to expose the container on the port 27017
docker run -it -d --name wagmi-mongo -p 27017:27017 --restart=unless-stopped -e MONGO_INITDB_ROOT_USERNAME=root -e MONGO_INITDB_ROOT_PASSWORD=pwd mongo

docker exec -it wagmi-mongo mongosh -u root -p pwd --authenticationDatabase wagmi
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