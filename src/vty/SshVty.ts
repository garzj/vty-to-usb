import { Vty } from './Vty';
import { Server, utils } from 'ssh2';
import { sshKeyFile } from '../config/paths';
import { z } from 'zod';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Bridge } from '../Bridge';
import { jsonStringifyPretty } from '../ts/json';
import { EventSubscriber } from '../ts/EventSubscriber';

const keyPairSchema = z.object({
  private: z.string(),
  public: z.string(),
});

type KeyPair = z.infer<typeof keyPairSchema>;

let keyPair: KeyPair;
if (existsSync(sshKeyFile)) {
  const data = JSON.parse(readFileSync(sshKeyFile).toString());
  keyPair = keyPairSchema.parse(data);
} else {
  keyPair = (utils as any).generateKeyPairSync('rsa', {
    bits: 2048,
  }) as KeyPair;
  writeFileSync(sshKeyFile, jsonStringifyPretty(keyPair));
}

export class SshVty extends Vty {
  server: Server;

  constructor(bridge: Bridge, port: number) {
    super(bridge, port);

    this.server = new Server({
      hostKeys: [keyPair.private],
    });

    this.server.on('connection', (client) => {
      client.on('authentication', async (ctx) => {
        // ouch
        const appCfg = this.bridge.app.config.getRef();
        const bridgeCfg = this.bridge.config.getRef();
        if (appCfg.sshRootPassword === '' || bridgeCfg.sshPassword == '')
          return ctx.accept();
        if (ctx.method !== 'password') return ctx.reject();
        if (ctx.username === 'root' && ctx.password === appCfg.sshRootPassword)
          return ctx.accept();
        if (
          ctx.username === bridgeCfg.sshUser &&
          ctx.password === bridgeCfg.sshPassword
        )
          return ctx.accept();
        return ctx.reject();
      });

      client.on('ready', () => {
        client.on('session', (accept) => {
          const session = accept();

          session.on('pty', (accept) => accept());

          session.on('shell', (accept) => {
            const stream = accept();

            this.bridge.clientCount++;
            stream.once('close', () => this.bridge.clientCount--);

            stream.write(this.getBanner());

            stream.on('data', (chunk: Buffer) => {
              // Ctrl + D
              if (chunk.length === 1 && chunk[0] === 0x04) return stream.end();

              this.emit('data', chunk);
            });

            const writeSub = new EventSubscriber(this);
            writeSub.on('write', (chunk: Buffer) => {
              stream.write(chunk);
            });
            stream.on('close', () => writeSub.off());
          });
        });
      });
    });

    this.listen && this.server.listen(port);

    this.once('close', () => this.server.close());
  }
}
