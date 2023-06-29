# vty-to-usb

A service bridging telnet/ssh connections to USB serial ports.

## Installation

- Install [Node](https://nodejs.org/en)
- Install [yarn](https://classic.yarnpkg.com/lang/en/docs/install/#debian-stable) and [pm2](https://pm2.keymetrics.io/):
  ```bash
  npm i -g yarn pm2
  pm2 startup -u $USER # Copy-paste the given command
  ```
- Build the app:
  ```bash
  git clone https://github.com/garzj/vty-to-usb.git
  cd vty-to-usb
  yarn
  yarn build
  ```

## Start the service

```bash
pm2 start ./build/index.js --name vty-to-usb
pm2 save
```

**Note:** One might need to mask the `brltty` (or `brltty.path`) service if it messes with the serial ports: `systemctl mask brltty`

## Stop the service

```bash
pm2 stop --name vty-to-usb
pm2 save
```

## Configuration info

- All settings can be configured in the data directory.
- Empty passwords mean **no authentication**.
- A port of value `0` means, the service is disabled.
