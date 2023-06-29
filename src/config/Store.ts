import * as z from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { watch } from 'chokidar';
import { TypedEmitter } from 'tiny-typed-emitter';
import { exists } from './paths';
import { jsonStringifyPretty } from '../ts/json';
import deepEqual = require('deep-equal');

const RETRY_DELAY = 10000;

interface StoreEvents<S extends z.ZodSchema> {
  change: (current: z.infer<S>, previous: z.infer<S>) => void;
}

// some poor design, will result in infinite read write loops
export class Store<S extends z.ZodSchema> extends TypedEmitter<StoreEvents<S>> {
  private loader: Promise<z.infer<S>> | null = null;
  private retryTimeout?: NodeJS.Timeout;

  constructor(public readonly file: string, public readonly schema: S) {
    super();

    this.setup();
  }

  async writeDefault() {
    let data: z.infer<S>;
    try {
      data = await this.schema.parseAsync(undefined);
    } catch (e) {
      try {
        data = await this.schema.parseAsync({});
      } catch (e) {
        console.error(`Warning: Store has no default schema: ${this.file}`);
        data = {};
      }
    }
    await writeFile(this.file, jsonStringifyPretty(data));
  }

  async setup() {
    if (!(await exists(this.file))) {
      await this.writeDefault();
    }

    watch(this.file, { awaitWriteFinish: true })
      .on('change', async () => {
        clearTimeout(this.retryTimeout);
        this.retryTimeout = undefined;

        const prev = await this.loader;
        this.loader = this.load();
        const cur = await this.loader;
        this.emit('change', cur, prev);
      })
      .on('unlink', () => this.writeDefault());
  }

  private async load(): Promise<z.infer<S>> {
    let data!: z.infer<S>;
    try {
      const _data = JSON.parse((await readFile(this.file)).toString());
      data = await this.schema.parseAsync(_data);
    } catch (e) {
      console.error(`Failed to parse config file: ${this.file}`);
      console.error(`${e}`);
      console.error(`Retrying in ${Math.floor(RETRY_DELAY / 1000)}s.`);
      return await new Promise((resolve) => {
        this.retryTimeout = setTimeout(() => {
          resolve(this.load());
        }, RETRY_DELAY);
      });
    }
    return data;
  }

  async get() {
    if (!(await exists(this.file))) {
      await this.writeDefault();
    }

    if (!this.loader) this.loader = this.load();
    return await this.loader;
  }

  async save(o: z.infer<S>) {
    if (deepEqual(o, await this.get())) return;
    await writeFile(this.file, jsonStringifyPretty(o));
  }
}
