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

export class Store<S extends z.ZodSchema> extends TypedEmitter<StoreEvents<S>> {
  private loader: Promise<z.infer<S>> | null = null;

  data: z.infer<S>;
  lastData: z.infer<S>;

  creatingNew = false;
  beforeLoad = true;

  constructor(
    public readonly file: string,
    public readonly schema: S,
    private getDefaultCb?: (isNew: boolean) => z.infer<S>
  ) {
    super();

    this.data = this.getDefault();
    this.lastData = JSON.parse(JSON.stringify(this.data));

    this.ensureLoaded();

    watch(this.file, { awaitWriteFinish: true })
      .on('change', async () => {
        const data = this.loadValid();
        if (deepEqual(data, this.data)) return;
        this.lastData = JSON.parse(JSON.stringify(this.data));
        this.data = data;
        this.emit('change', this.data, this.lastData);
      })
      .on('unlink', () => this.write(undefined, true));
  }

  async ensureLoaded() {
    if (!(await exists(this.file))) {
      if (this.creatingNew) return await this.loadValid();
      this.creatingNew = true;
      this.data = this.getDefault(true);
      return await this.write(this.data, true);
    }
    const data = await this.loadValid();
    this.beforeLoad = false;
    return data;
  }

  private async loadValid() {
    if (this.loader) return await this.loader;
    this.loader = this._tryLoadValid();
    return await this.loader;
  }

  private async _tryLoadValid() {
    let data!: z.infer<S>;
    try {
      const _data = JSON.parse((await readFile(this.file)).toString());
      data = await this.schema.parseAsync(_data);
    } catch (e) {
      console.error(`Failed to parse config file: ${this.file}`);
      console.error(`${e}`);
      console.error(`Retrying in ${Math.floor(RETRY_DELAY / 1000)}s.`);
      return await new Promise((resolve) => {
        setTimeout(() => {
          resolve(this._tryLoadValid());
        }, RETRY_DELAY);
      });
    }
    return data;
  }

  getDefault(isNew = false) {
    if (this.getDefaultCb) return this.getDefaultCb(isNew);

    let data: z.infer<S>;
    try {
      data = this.schema.parse(undefined);
    } catch (e) {
      try {
        data = this.schema.parse({});
      } catch (e) {
        console.error(`Warning: Store has no default schema: ${this.file}`);
        data = {};
      }
    }
    return data;
  }

  getRef(): z.infer<S> {
    return this.data;
  }

  async write(primitive?: z.infer<S>, force = false) {
    if (primitive !== undefined) this.data = primitive;

    if (this.beforeLoad && !force) {
      await this.ensureLoaded();
      this.write();
      return;
    }

    if (!force && deepEqual(this.lastData, this.data)) return;

    this.emit('change', this.data, this.lastData);
    this.lastData = JSON.parse(JSON.stringify(this.data));
    await writeFile(this.file, jsonStringifyPretty(this.data));

    // TODO: No concurrent writing?
  }
}
