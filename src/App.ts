import { watch } from 'chokidar';
import { Bridge } from './Bridge';
import { z } from 'zod';
import { Store } from './config/Store';
import { configFile } from './config/paths';

const DEV_PATH = '/dev/serial/by-path';

const configSchema = z.object({
  minPortTelnet: z.number().default(5000),
  minPortSsh: z.number().default(6000),
  defaultBaudRate: z.number().default(9600),
  maxSerialCache: z.number().default(1000),
  sshRootPassword: z.string().default('vtytousb'),
});
export type AppConfig = z.infer<typeof configSchema>;

export class App {
  usedPorts = new Set<number>();

  config = new Store(configFile, configSchema);
  bridges = new Map<string, Bridge>();

  constructor() {
    watch(DEV_PATH, { ignoreInitial: false, usePolling: true })
      .on('add', async (path) => {
        console.log(`Port ${path} added.`);

        const bridge = new Bridge(this, path, await this.config.get());
        this.bridges.set(path, bridge);
      })
      .on('unlink', (path) => {
        console.log(`Port ${path} removed.`);
        this.bridges.get(path)?.emit('close');
        this.bridges.delete(path);
      });

    this.config.on('change', () => console.log('Applied new app config.'));
  }

  nextFreePort(min: number) {
    let port = min;
    while (this.usedPorts.has(port)) {
      port++;
    }
    return port;
  }

  destroy() {
    this.config.removeAllListeners();
  }
}
