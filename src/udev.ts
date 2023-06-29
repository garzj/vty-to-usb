import { spawn } from 'child_process';
import { streamToString } from './ts/stream';
import { splitLines } from './ts/str';

export async function getDevProps(
  devicePath: string,
  propNames?: string[]
): Promise<Map<string, string>> {
  const proc = spawn('udevadm', [
    'info',
    devicePath,
    '--query',
    ...(propNames === undefined
      ? ['all']
      : ['property', '--property', propNames.join(',')]),
  ]);
  const data = await streamToString(proc.stdout);

  const props = new Map<string, string>();
  for (const line of splitLines(data)) {
    const [propName] = line.split('=', 1);
    const propVal = line.slice(propName.length + 1, line.length);
    props.set(propName, propVal);
  }
  return props;
}
