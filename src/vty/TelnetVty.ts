import { Server, createServer } from 'net';
import { Vty } from './Vty';
import { EventSubscriber } from '../ts/EventSubscriber';
import { Bridge } from '../Bridge';

export class TelnetVty extends Vty {
  server: Server;

  constructor(bridge: Bridge, port: number) {
    super(bridge, port);

    this.server = createServer();

    this.server.on('connection', (socket) => {
      this.bridge.clientCount++;
      socket.once('close', () => this.bridge.clientCount--);

      socket.setEncoding('ascii');
      // ff=IAC fb=WILL 01=ECHO
      socket.write(Buffer.from([0xff, 0xfb, 0x01]));
      // ff=IAC fb=WILL 03=SUPPRESS_GO_AHEAD
      socket.write(Buffer.from([0xff, 0xfb, 0x03]));
      // ff=IAC fe=DON'T 18=TERMINAL_TYPE
      socket.write(Buffer.from([0xff, 0xfe, 0x18]));
      // ff=IAC fe=DON'T 1f=NEGOTIATE_WIN_SIZE
      socket.write(Buffer.from([0xff, 0xfe, 0x1f]));
      // ff=IAC fd=DO 22=LINEMODE
      socket.write(Buffer.from([0xff, 0xfd, 0x22]));
      // ff=IAC f0=END_OF_NEGOTIATION
      socket.write(Buffer.from([0xff, 0xf0]));

      socket.write(this.getBanner());

      socket.on('data', (chunk: Buffer) => {
        chunk = Buffer.from(chunk);

        // todo: ignore initial negitioation data in response to IAC DO LINEMODE

        // filter telnet's null bytes after newlines
        chunk = Buffer.from(chunk.filter((char) => char !== 0x00));

        // Ctrl + D
        if (chunk.length === 1 && chunk[0] === 0x04) socket.destroy();

        this.emit('data', chunk);
      });

      const writeSub = new EventSubscriber(this);
      writeSub.on('write', (chunk: Buffer) => {
        // filter unintentional telnet command sequences
        chunk = Buffer.from(chunk.filter((char) => char !== 0xff));

        socket.write(chunk);
      });
      socket.on('close', () => writeSub.off());
    });

    this.listen && this.server.listen(port);

    this.once('close', () => {
      this.server.close();
    });
  }
}
