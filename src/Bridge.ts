import { SerialPort } from 'serialport';
import { TypedEmitter } from 'tiny-typed-emitter';
import { EventSubscriber } from './ts/EventSubscriber';
import { TelnetVty } from './vty/TelnetVty';
import { SshVty } from './vty/SshVty';
import { App, AppConfig } from './App';
import { Store } from './config/Store';
import { basename, join } from 'path';
import { serialsDir } from './config/paths';
import sanitize = require('sanitize-filename');
import { z } from 'zod';

const bridgeConfigSchema = z.object({
  sshPort: z.number(),
  telnetPort: z.number(),
  baudRate: z.number(),
  sshUser: z.string(),
  sshPassword: z.string(),
});
type BridgeConf = z.infer<typeof bridgeConfigSchema>;

interface BridgeEvents {
  data: (data: Buffer) => void;
  write: (data: Buffer) => void;
  close: () => void;
}

export class Bridge extends TypedEmitter<BridgeEvents> {
  store!: Store<ReturnType<(typeof bridgeConfigSchema)['default']>>;
  appConfigSub: EventSubscriber;

  serial?: SerialPort;
  serialSub?: EventSubscriber;

  telnetVty?: TelnetVty;
  sshVty?: SshVty;

  clientCount = 0;

  maxSerialCache = 1000;
  serialCache = Buffer.from('');

  id: string;

  constructor(public app: App, public path: string, config: AppConfig) {
    super();

    this.appConfigSub = new EventSubscriber(app.config);
    this.appConfigSub.on('change', (cur: AppConfig) => {
      this.maxSerialCache = cur.maxSerialCache;
      this.trimCache();
    });
    this.app.config.get().then((cur) => {
      this.maxSerialCache = cur.maxSerialCache;
    });

    // TODO: More reliable id with udev data
    this.id = sanitize(basename(this.path), { replacement: '_' });

    this.setup(config);

    this.on('write', (data) => this.serial?.write(data));

    this.once('close', () => this.destroy());
  }

  async setup(appConf: AppConfig) {
    const configFile = join(serialsDir, this.id + '.json');
    this.store = new Store(
      configFile,
      bridgeConfigSchema.default({
        sshPort: appConf.minPortSsh,
        telnetPort: appConf.minPortTelnet,
        baudRate: appConf.defaultBaudRate,
        sshUser: 'user',
        sshPassword: 'vtytousb',
      })
    );

    this.store.on('change', () =>
      console.log(`Applied config for bridge ${this.id}.`)
    );

    this.setupSerial(await this.store.get());
    this.store.on('change', (cur, prev) => {
      if (prev.baudRate != cur.baudRate) this.setupSerial(cur);
    });

    await this.createVtys();
  }

  private setupSerial(conf: BridgeConf) {
    this.serialSub?.off();
    this.serial?.close();

    this.serial = new SerialPort({
      path: this.path,
      baudRate: conf.baudRate,
    });
    this.serialSub = new EventSubscriber(this.serial as any);
    this.serialSub.once('close', () => this.destroy());

    this.serialSub.on('data', (buf: Buffer) => {
      buf = Buffer.from(buf);

      this.serialCache = Buffer.concat([this.serialCache, buf]);
      this.trimCache();
      this.emit('data', buf);
    });
  }

  trimCache() {
    if (this.serialCache.length > this.maxSerialCache) {
      this.serialCache = this.serialCache.subarray(
        this.serialCache.length - this.maxSerialCache
      );
    }
  }

  async createVtys() {
    await this.setupTelnet(await this.store.get());
    await this.setupSsh(await this.store.get());
    this.store.on('change', async (cur, prev) => {
      if (cur.telnetPort != prev.telnetPort) await this.setupTelnet(cur);
      if (cur.sshPort != prev.sshPort) await this.setupSsh(cur);
    });
  }

  private async setupTelnet(conf: BridgeConf) {
    this.telnetVty?.emit('close');

    if (conf.telnetPort === 0) return;

    const port = this.app.nextFreePort(conf.telnetPort);
    conf.telnetPort = port;
    this.telnetVty = new TelnetVty(this, port);
    await this.store.save(conf);
  }

  private async setupSsh(conf: BridgeConf) {
    this.sshVty?.emit('close');

    if (conf.sshPort === 0) return;

    const port = this.app.nextFreePort(conf.sshPort);
    conf.sshPort = port;
    this.sshVty = new SshVty(this, conf.sshPort);
    await this.store.save(conf);
  }

  private destroy() {
    this.removeAllListeners();
    this.store.removeAllListeners();
    this.appConfigSub.off();
    this.serialSub?.off();
    this.serial?.close();
    this.telnetVty?.emit('close');
    this.sshVty?.emit('close');
  }
}
