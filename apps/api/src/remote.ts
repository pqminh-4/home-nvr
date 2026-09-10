import { existsSync, statSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AppConfig } from './config.js';

export type RemoteHealth = 'disabled' | 'configured' | 'starting' | 'ready' | 'error';

export interface RemoteManager {
  health(): RemoteHealth;
  publicOrigin(): string | null;
  reconcile(enabled: boolean): Promise<void>;
  shutdown(): Promise<void>;
}

export class CloudflareTunnelService implements RemoteManager {
  private child: ChildProcess | undefined;
  private state: RemoteHealth;
  private readyTimer: NodeJS.Timeout | undefined;

  constructor(private readonly config: AppConfig) {
    this.state = config.publicOrigin && config.tunnelTokenFile ? 'configured' : 'disabled';
  }

  health() { return this.state; }
  publicOrigin() { return this.config.publicOrigin || null; }

  async reconcile(enabled: boolean) {
    if (!enabled) {
      await this.stop();
      this.state = this.config.publicOrigin && this.config.tunnelTokenFile ? 'configured' : 'disabled';
      return;
    }
    if (this.child && !this.child.killed) return;
    if (!this.config.publicOrigin || !this.config.tunnelTokenFile || !existsSync(this.config.tunnelTokenFile)) {
      this.state = 'error';
      return;
    }
    if (process.platform !== 'win32' && (statSync(this.config.tunnelTokenFile).mode & 0o077) !== 0) {
      this.state = 'error';
      return;
    }
    this.state = 'starting';
    const child = spawn(this.config.cloudflaredBinary, ['tunnel', '--protocol', 'auto', 'run', '--token-file', this.config.tunnelTokenFile], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    // Không đưa output cloudflared vào log ứng dụng vì có thể chứa thông tin hạ tầng.
    child.stdout?.resume();
    child.stderr?.resume();
    child.once('error', () => { if (this.child === child) { this.child = undefined; this.state = 'error'; } });
    child.once('exit', () => { if (this.child === child) { this.child = undefined; this.state = 'error'; } });
    this.readyTimer = setTimeout(() => {
      if (this.child === child && child.exitCode === null && !child.killed) this.state = 'ready';
    }, 1500);
    this.readyTimer.unref();
  }

  private async stop() {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = undefined;
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); resolve(); }, 3000);
      timeout.unref();
      child.once('exit', () => { clearTimeout(timeout); resolve(); });
    });
  }

  async shutdown() {
    await this.stop();
    this.state = 'disabled';
  }
}
