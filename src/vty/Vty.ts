import { TypedEmitter } from 'tiny-typed-emitter';
import { Bridge } from '../Bridge';

interface VtyEvents {
  data: (data: Buffer) => void;
  write: (data: Buffer) => void;
  close: () => void;
}

export abstract class Vty extends TypedEmitter<VtyEvents> {
  constructor(public bridge: Bridge, public port: number) {
    super();

    this.bridge.app.usedPorts.add(this.port);

    bridge.on('data', (data) => this.emit('write', data));
    this.on('data', (data) => bridge.emit('write', data));

    console.log(`${this.constructor.name} opened port ${port} -> ${bridge.id}`);

    this.once('close', () => this.destroy());
  }

  getBanner(): Buffer {
    let ban = '';
    ban += `Connected to serial port ${this.bridge.id}.\n`;
    if (this.bridge.serialCache.length > 0) {
      ban += `Showing previous output up to ${this.bridge.maxSerialCache} characters.\n`;
    }
    if (this.bridge.clientCount > 1) {
      ban += `\nWarning: There are now ${this.bridge.clientCount} clients connected to this port.\n`;
    }

    const msgBuf = Buffer.from(ban.replace(/\n/g, '\r\n'));
    return Buffer.concat([msgBuf, this.bridge.serialCache]);
  }

  private destroy() {
    this.removeAllListeners();

    this.bridge.app.usedPorts.delete(this.port);

    console.log(`${this.constructor.name} closed port ${this.port}.`);
  }
}
