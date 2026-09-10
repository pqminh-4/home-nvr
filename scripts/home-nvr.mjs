#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, chmod, copyFile, cp, lstat, mkdir, mkdtemp, readFile, readlink, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  APP_NAME,
  MEDIAMTX_VERSION,
  RELEASE_FILES,
  SERVICE_NAME,
  checksumForAsset,
  cloudflaredReleaseAsset,
  createInstallLayout,
  isInside,
  mediaMtxAsset,
  parseEnvironment,
  renderEnvironment,
  renderSystemdService,
  validateReleaseSource,
} from './installer-lib.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const wait = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
const exists = async path => access(path).then(() => true).catch(() => false);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    timeout: options.timeout ?? 15 * 60_000,
    windowsHide: true,
    shell: false,
  });
  if (result.error && !options.allowFailure) throw result.error;
  if (result.status !== 0 && !options.allowFailure) throw new Error(`${command} thất bại với mã ${result.status ?? 'không xác định'}.`);
  return result;
}

function runNpm(args, options = {}) {
  const npmCli = process.env.npm_execpath;
  return npmCli ? run(process.execPath, [npmCli, ...args], options) : run('npm', args, options);
}

function commandAvailable(command, args = ['--version']) {
  const result = run(command, args, { capture: true, allowFailure: true, timeout: 10_000 });
  return !result.error && result.status === 0;
}

async function assertUbuntuRoot() {
  if (process.platform !== 'linux') throw new Error('Installer chỉ chạy trên Ubuntu Linux.');
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) throw new Error('Hãy chạy installer bằng sudo.');
  const osRelease = await readFile('/etc/os-release', 'utf8');
  if (!/^ID=ubuntu$/m.test(osRelease)) throw new Error('Installer hiện chỉ hỗ trợ Ubuntu.');
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Cần Node.js 24 trước khi cài Home NVR.');
  const npmResult = runNpm(['--version'], { capture: true });
  if (Number(String(npmResult.stdout).trim().split('.')[0]) < 11) throw new Error('Cần npm 11 trở lên.');
  for (const command of ['apt-get', 'systemctl', 'tar']) {
    if (!commandAvailable(command, command === 'apt-get' ? ['--version'] : ['--version'])) throw new Error(`Thiếu công cụ hệ thống: ${command}.`);
  }
  if (/^\/(root|home)\//.test(process.execPath)) throw new Error('Node.js dùng cho systemd phải nằm ngoài /root và /home.');
}

async function writeAtomic(path, content, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, { mode, flag: 'wx' });
  await chmod(temporary, mode);
  await rename(temporary, path);
}

async function installSystemDependencies() {
  if (commandAvailable('ffmpeg', ['-version']) && commandAvailable('tar')) return;
  run('apt-get', ['update']);
  run('apt-get', ['install', '-y', '--no-install-recommends', 'ca-certificates', 'ffmpeg', 'tar']);
}

async function ensureServiceUser() {
  const found = run('id', ['-u', APP_NAME], { capture: true, allowFailure: true });
  if (found.status === 0) return;
  run('useradd', ['--system', '--user-group', '--home-dir', '/var/lib/home-nvr', '--shell', '/usr/sbin/nologin', APP_NAME]);
}

async function ensureDirectories(layout) {
  for (const [path, mode] of [[layout.opt, 0o755], [layout.releases, 0o755], [layout.bin, 0o755], [layout.config, 0o750], [layout.data, 0o700], [layout.backups, 0o700]]) {
    await mkdir(path, { recursive: true, mode });
    await chmod(path, mode);
  }
  run('chown', ['home-nvr:home-nvr', layout.data, layout.backups]);
  run('chown', ['root:home-nvr', layout.config]);
}

async function download(url, maximumBytes = 150 * 1024 * 1024) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Không tải được ${new URL(url).pathname}.`);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maximumBytes) throw new Error('Tệp tải xuống vượt giới hạn an toàn.');
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > maximumBytes) throw new Error('Tệp tải xuống vượt giới hạn an toàn.');
  return data;
}

async function installMediaMtx(layout) {
  const target = join(layout.bin, 'mediamtx');
  if (await exists(target)) return;
  const asset = mediaMtxAsset(process.arch);
  const base = `https://github.com/bluenviron/mediamtx/releases/download/v${MEDIAMTX_VERSION}`;
  const [archive, checksums] = await Promise.all([download(`${base}/${asset}`), download(`${base}/checksums.sha256`, 1024 * 1024)]);
  const expected = checksumForAsset(checksums.toString('utf8'), asset);
  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== expected) throw new Error('Checksum MediaMTX không khớp.');
  const temporary = await mkdtemp(join(tmpdir(), 'home-nvr-mediamtx-'));
  try {
    const archivePath = join(temporary, asset);
    await writeFile(archivePath, archive, { mode: 0o600 });
    run('tar', ['-xzf', archivePath, '-C', temporary]);
    await copyFile(join(temporary, 'mediamtx'), `${target}.tmp`);
    await chmod(`${target}.tmp`, 0o755);
    await rename(`${target}.tmp`, target);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function installCloudflared(layout) {
  const target = join(layout.bin, 'cloudflared');
  if (await exists(target)) return;
  const metadata = JSON.parse((await download('https://api.github.com/repos/cloudflare/cloudflared/releases/latest', 2 * 1024 * 1024)).toString('utf8'));
  const asset = cloudflaredReleaseAsset(metadata, process.arch);
  const binary = await download(asset.url, 100 * 1024 * 1024);
  const actual = createHash('sha256').update(binary).digest('hex');
  if (actual !== asset.sha256) throw new Error('Checksum cloudflared không khớp.');
  await writeFile(`${target}.tmp`, binary, { mode: 0o755 });
  await chmod(`${target}.tmp`, 0o755);
  await rename(`${target}.tmp`, target);
}

async function copyRelease(source, layout) {
  const stamp = new Date().toISOString().replace(/\D/g, '');
  const releaseId = `${source.version}-${stamp}`;
  const stage = join(layout.releases, `.stage-${releaseId}-${process.pid}`);
  const destination = join(layout.releases, releaseId);
  if (!isInside(layout.releases, stage) || !isInside(layout.releases, destination)) throw new Error('Đường dẫn release không an toàn.');
  await mkdir(stage, { recursive: false, mode: 0o755 });
  try {
    for (const item of RELEASE_FILES) {
      const from = join(source.root, item);
      const targetItem = item === 'release-lock.json' ? 'package-lock.json' : item;
      const to = join(stage, targetItem);
      await mkdir(dirname(to), { recursive: true, mode: 0o755 });
      const info = await lstat(from);
      if (info.isSymbolicLink()) throw new Error(`Gói phát hành chứa symlink không được phép: ${item}`);
      await cp(from, to, { recursive: info.isDirectory(), errorOnExist: true, force: false });
    }
    await writeFile(join(stage, '.npmrc'), 'engine-strict=true\nsave-exact=true\n', { mode: 0o600 });
    await chmod(join(stage, 'scripts/home-nvr.mjs'), 0o755);
    runNpm(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage });
    run(process.execPath, ['--check', join(stage, 'apps/api/dist/main.js')]);
    run(process.execPath, ['--input-type=module', '--eval', "await import('@home-nvr/contracts')"], { cwd: stage });
    run('chown', ['-R', 'root:root', stage]);
    await rename(stage, destination);
    return { id: releaseId, path: destination };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

async function currentRelease(layout) {
  try {
    const link = await readlink(layout.current);
    const target = resolve(dirname(layout.current), link);
    return isInside(layout.releases, target) ? target : null;
  } catch {
    return null;
  }
}

async function switchRelease(layout, target) {
  if (!isInside(layout.releases, target)) throw new Error('Release đích nằm ngoài thư mục được quản lý.');
  await access(join(target, 'apps/api/dist/main.js'));
  const temporary = `${layout.current}.tmp-${process.pid}`;
  await rm(temporary, { force: true });
  await symlink(target, temporary, 'dir');
  await rename(temporary, layout.current);
}

async function linkCli(layout) {
  await mkdir(dirname(layout.cli), { recursive: true, mode: 0o755 });
  const temporary = `${layout.cli}.tmp-${process.pid}`;
  await rm(temporary, { force: true });
  await symlink(join(layout.current, 'scripts/home-nvr.mjs'), temporary, 'file');
  await rename(temporary, layout.cli);
}

async function readState(layout) {
  try { return JSON.parse(await readFile(layout.stateFile, 'utf8')); }
  catch { return { current: null, previous: null }; }
}

async function writeState(layout, state) {
  await writeAtomic(layout.stateFile, JSON.stringify(state, null, 2) + '\n', 0o600);
}

async function ensureEnvironment(layout) {
  if (await exists(layout.envFile)) return { created: false, values: parseEnvironment(await readFile(layout.envFile, 'utf8')) };
  const setupToken = randomBytes(36).toString('base64url');
  const secretKey = randomBytes(48).toString('base64url');
  await writeAtomic(layout.envFile, renderEnvironment(layout, { setupToken, secretKey }), 0o600);
  return { created: true, setupToken, values: parseEnvironment(await readFile(layout.envFile, 'utf8')) };
}

async function waitForHealth(values) {
  const port = Number(values.NVR_PORT || 3000);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* Tiếp tục chờ systemd khởi động dịch vụ. */ }
    await wait(1000);
  }
  throw new Error('Home NVR không đạt readiness sau 30 giây.');
}

async function pruneReleases(layout, keepPaths) {
  const entries = await readdir(layout.releases, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.stage-')) continue;
    const path = join(layout.releases, entry.name);
    const info = await lstat(path);
    candidates.push({ path, modified: info.mtimeMs });
  }
  candidates.sort((a, b) => b.modified - a.modified);
  const keep = new Set([...keepPaths.filter(Boolean).map(resolve), ...candidates.slice(0, 3).map(item => resolve(item.path))]);
  for (const item of candidates) {
    if (!keep.has(resolve(item.path)) && isInside(layout.releases, item.path)) await rm(item.path, { recursive: true, force: true });
  }
}

async function installOrUpdate() {
  await assertUbuntuRoot();
  const source = await validateReleaseSource(packageRoot);
  const layout = createInstallLayout('/');
  if (isInside(layout.releases, source.root)) throw new Error('Để cập nhật, hãy chạy lại lệnh npm exec từ GitHub Releases.');
  await installSystemDependencies();
  await ensureServiceUser();
  await ensureDirectories(layout);
  await installMediaMtx(layout);
  await installCloudflared(layout);
  const environment = await ensureEnvironment(layout);
  const prior = await currentRelease(layout);
  const release = await copyRelease(source, layout);
  await writeAtomic(layout.serviceFile, renderSystemdService(layout, process.execPath), 0o644);
  await switchRelease(layout, release.path);
  await linkCli(layout);
  run('systemctl', ['daemon-reload']);
  try {
    run('systemctl', ['enable', '--now', SERVICE_NAME]);
    run('systemctl', ['restart', SERVICE_NAME]);
    await waitForHealth(environment.values);
  } catch (error) {
    if (prior) {
      await switchRelease(layout, prior);
      run('systemctl', ['restart', SERVICE_NAME], { allowFailure: true });
    }
    throw error;
  }
  await writeState(layout, { version: source.version, current: release.path, previous: prior, installedAt: new Date().toISOString() });
  await pruneReleases(layout, [release.path, prior]);
  console.log(JSON.stringify({ ok: true, action: prior ? 'updated' : 'installed', version: source.version, url: 'http://127.0.0.1:3000', setupToken: environment.created ? environment.setupToken : undefined }, null, 2));
}

async function rollback() {
  await assertUbuntuRoot();
  const layout = createInstallLayout('/');
  const state = await readState(layout);
  const current = await currentRelease(layout);
  const previous = state.previous ? resolve(state.previous) : null;
  if (!current || !previous || !isInside(layout.releases, previous)) throw new Error('Không có release trước để rollback.');
  await switchRelease(layout, previous);
  run('systemctl', ['restart', SERVICE_NAME]);
  const values = parseEnvironment(await readFile(layout.envFile, 'utf8'));
  try { await waitForHealth(values); }
  catch (error) {
    await switchRelease(layout, current);
    run('systemctl', ['restart', SERVICE_NAME], { allowFailure: true });
    throw error;
  }
  await writeState(layout, { ...state, current: previous, previous: current, rolledBackAt: new Date().toISOString() });
  console.log(JSON.stringify({ ok: true, current: previous, previous: current }, null, 2));
}

async function status() {
  const layout = createInstallLayout('/');
  const state = await readState(layout);
  const service = run('systemctl', ['is-active', SERVICE_NAME], { capture: true, allowFailure: true });
  console.log(JSON.stringify({ service: String(service.stdout || service.stderr).trim() || 'unknown', release: await currentRelease(layout), state }, null, 2));
}

async function runMaintenance(command, args) {
  await assertUbuntuRoot();
  const layout = createInstallLayout('/');
  const current = await currentRelease(layout);
  if (!current) throw new Error('Home NVR chưa được cài đặt.');
  const values = parseEnvironment(await readFile(layout.envFile, 'utf8'));
  if (command === 'restore') run('systemctl', ['stop', SERVICE_NAME]);
  try {
    const forwarded = [...args];
    if (command === 'backup' && !forwarded.includes('--output')) forwarded.push('--output', join(layout.backups, `manual-${Date.now()}`));
    run(process.execPath, [join(current, `scripts/${command}.mjs`), ...forwarded], { cwd: current, env: { ...process.env, ...values } });
  } finally {
    if (command === 'restore') run('systemctl', ['start', SERVICE_NAME], { allowFailure: true });
  }
}

async function uninstall(args) {
  await assertUbuntuRoot();
  if (args.includes('--purge') && !args.includes('--yes')) throw new Error('Gỡ cả dữ liệu cần đồng thời --purge --yes.');
  const layout = createInstallLayout('/');
  run('systemctl', ['disable', '--now', SERVICE_NAME], { allowFailure: true });
  await rm(layout.serviceFile, { force: true });
  await rm(layout.cli, { force: true });
  await rm(layout.current, { force: true });
  await rm(layout.releases, { recursive: true, force: true });
  await rm(layout.bin, { recursive: true, force: true });
  await rm(layout.stateFile, { force: true });
  run('systemctl', ['daemon-reload']);
  if (args.includes('--purge')) {
    for (const path of [layout.data, layout.backups, layout.config]) await rm(path, { recursive: true, force: true });
    run('userdel', [APP_NAME], { allowFailure: true });
  }
  console.log(JSON.stringify({ ok: true, purged: args.includes('--purge'), retained: args.includes('--purge') ? [] : [layout.data, layout.backups, layout.config] }, null, 2));
}

async function plan() {
  const source = await validateReleaseSource(packageRoot);
  const layout = createInstallLayout('/');
  console.log(JSON.stringify({
    package: `${APP_NAME}@${source.version}`,
    supported: { os: 'Ubuntu', architectures: ['x64', 'arm64'], node: '24.x', npm: '>=11' },
    layout,
    service: SERVICE_NAME,
    mediaMtx: MEDIAMTX_VERSION,
    releaseFiles: RELEASE_FILES,
  }, null, 2));
}

function help() {
  console.log(`Home NVR installer\n\nLệnh:\n  home-nvr install\n  home-nvr update\n  home-nvr rollback\n  home-nvr status\n  home-nvr doctor\n  home-nvr backup [--output PATH] [--metadata-only]\n  home-nvr restore --input PATH --force\n  home-nvr uninstall [--purge --yes]\n  home-nvr plan`);
}

async function main() {
  const [command = 'help', ...args] = process.argv.slice(2);
  if (command === 'install' || command === 'update') return installOrUpdate();
  if (command === 'rollback') return rollback();
  if (command === 'status') return status();
  if (command === 'backup' || command === 'restore' || command === 'doctor') return runMaintenance(command, args);
  if (command === 'uninstall') return uninstall(args);
  if (command === 'plan') return plan();
  help();
  if (!['help', '--help', '-h'].includes(command)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Installer Home NVR thất bại.');
    process.exitCode = 1;
  });
}
