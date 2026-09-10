import { readFile, writeFile } from 'node:fs/promises';

const source = await readFile(new URL('../package-lock.json', import.meta.url));
const targetUrl = new URL('../release-lock.json', import.meta.url);
if (process.argv.includes('--check')) {
  const target = await readFile(targetUrl).catch(() => null);
  if (!target || !source.equals(target)) {
    console.error('release-lock.json chưa đồng bộ với package-lock.json.');
    process.exitCode = 1;
  }
} else {
  // npm không đưa package-lock.json vào tarball; giữ bản sao có kiểm soát cho release.
  await writeFile(targetUrl, source, { mode: 0o600 });
  console.log('Đã đồng bộ release-lock.json.');
}
