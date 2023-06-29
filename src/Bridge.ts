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
  config!: Store<typeof bridgeConfigSchema>;
  appConfigSub!: EventSubscriber;

  serial?: SerialPort;
  serialSub?: EventSubscriber;

  telnetVty?: TelnetVty;
  sshVty?: SshVty;

  clientCount = 0;

  maxSerialCache = 1000;
  serialCache = Buffer.from('');

  id!: string;

  constructor(public app: App, public path: string) {
    super();

    this.setup();
  }

  async setup() {
    // TODO: More reliable id with udev data?
    this.id = sanitize(basename(this.path), { replacement: '_' });

    console.log(`New serial connection: ${this.id}.`);

    const configFile = join(serialsDir, this.id + '.json');
    let appConf = this.app.config.getRef();
    this.config = new Store(configFile, bridgeConfigSchema, (isNew) => {
      const sshPort = appConf.nextPortSsh;
      const telnetPort = appConf.nextPortTelnet;

      if (isNew) {
        appConf = this.app.config.getRef();
        appConf.nextPortSsh++;
        appConf.nextPortTelnet++;
        this.app.config.write();
      }

      return {
        sshPort: sshPort,
        telnetPort: telnetPort,
        baudRate: appConf.defaultBaudRate,
        sshUser: 'user',
        sshPassword: 'vtytousb',
      };
    });
    await this.config.ensureLoaded();

    this.config.on('change', () =>
      console.log(`Applied config for bridge ${this.id}.`)
    );

    this.appConfigSub = new EventSubscriber(this.app.config);
    this.appConfigSub.on('change', (cur: AppConfig) => {
      this.maxSerialCache = cur.maxSerialCache;
      this.trimCache();
    });
    this.maxSerialCache = this.app.config.getRef().maxSerialCache;

    this.setupSerial(this.config.getRef());
    this.config.on('change', (cur, prev) => {
      if (prev.baudRate != cur.baudRate) this.setupSerial(cur);
    });

    this.on('write', (data) => this.serial?.write(data));

    this.once('close', () => this.destroy());

    this.createVtys();
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
    await this.setupTelnet(await this.config.getRef());
    await this.setupSsh(await this.config.getRef());
    this.config.on('change', async (cur, prev) => {
      if (cur.telnetPort != prev.telnetPort) await this.setupTelnet(cur);
      if (cur.sshPort != prev.sshPort) await this.setupSsh(cur);
    });
  }

  private async setupTelnet(conf: BridgeConf) {
    this.telnetVty?.emit('close');
    if (conf.telnetPort === 0) return;
    this.telnetVty = new TelnetVty(this, conf.telnetPort);
  }

  private async setupSsh(conf: BridgeConf) {
    this.sshVty?.emit('close');
    if (conf.sshPort === 0) return;
    this.sshVty = new SshVty(this, conf.sshPort);
  }

  private destroy() {
    console.log(`Serial disconnected: ${this.id}`);

    this.removeAllListeners();
    this.config.removeAllListeners();
    this.appConfigSub.off();
    this.serialSub?.off();
    this.serial?.close();
    this.telnetVty?.emit('close');
    this.sshVty?.emit('close');
  }
}
