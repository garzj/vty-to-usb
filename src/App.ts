import { watch } from 'chokidar';
import { Bridge } from './Bridge';
import { z } from 'zod';
import { Store } from './config/Store';
import { configFile } from './config/paths';

const DEV_PATH = '/dev/serial/by-path';

const configSchema = z.object({
  nextPortTelnet: z.number().default(5000),
  nextPortSsh: z.number().default(6000),
  defaultBaudRate: z.number().default(9600),
  maxSerialCache: z.number().default(1000),
  sshRootPassword: z.string().default('vtytousb'),
});
export type AppConfig = z.infer<typeof configSchema>;

export class App {
  config = new Store(configFile, configSchema);
  bridges = new Map<string, Bridge>();

  usedPorts = new Set<number>();

  constructor() {
    this.config.on('change', () => console.log('Applied new app config.'));

    watch(DEV_PATH, { ignoreInitial: false, usePolling: true })
      .on('add', async (path) => {
        const bridge = new Bridge(this, path);
        this.bridges.set(path, bridge);
      })
      .on('unlink', (path) => {
        this.bridges.get(path)?.emit('close');
        this.bridges.delete(path);
      });
  }

  destroy() {
    this.config.removeAllListeners();
  }
}
