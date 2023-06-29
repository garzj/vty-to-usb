export function jsonStringifyPretty(data: any) {
  return JSON.stringify(data, null, 2) + '\n';
}
