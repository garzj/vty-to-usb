import { F_OK } from 'constants';
import { existsSync, mkdirSync } from 'fs';
import { access } from 'fs/promises';
import { join } from 'path';

export const exists = (file: string) =>
  access(file, F_OK)
    .then(() => true)
    .catch(() => false);

function ensureDirSync(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export const rootDir = join(__dirname, '../..');

export const dataDir = join(rootDir, 'data');
ensureDirSync(dataDir);
