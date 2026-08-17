import { ObjectStore } from './objectStore.interface';
import fs from 'fs';
import path from 'path';

/**
 * In-memory ObjectStore used for tests and local/dev fallback.
 * No network or credentials required.
 */
export class FakeObjectStore implements ObjectStore {
  private readonly blobs = new Map<string, Buffer>();
  private readonly baseDir = process.env.FAKE_OBJECT_STORE_DIR?.trim() || null;

  async put(
    key: string,
    data: Buffer | Uint8Array,
    _contentType?: string
  ): Promise<void> {
    const blob = Buffer.from(data);
    const target = this.pathFor(key);
    if (target) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, blob);
      return;
    }
    this.blobs.set(key, blob);
  }

  async get(key: string): Promise<Buffer | null> {
    const target = this.pathFor(key);
    if (target) {
      return fs.existsSync(target) ? fs.readFileSync(target) : null;
    }
    const value = this.blobs.get(key);
    return value === undefined ? null : value;
  }

  async delete(key: string): Promise<boolean> {
    const target = this.pathFor(key);
    if (target) {
      if (!fs.existsSync(target)) return false;
      fs.unlinkSync(target);
      return true;
    }
    return this.blobs.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const target = this.pathFor(key);
    if (target) {
      return fs.existsSync(target);
    }
    return this.blobs.has(key);
  }

  keys(prefix = ''): string[] {
    if (this.baseDir && fs.existsSync(this.baseDir)) {
      const out: string[] = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else {
            const key = path.relative(this.baseDir!, fullPath).split(path.sep).join('/');
            if (key.startsWith(prefix)) {
              out.push(key);
            }
          }
        }
      };
      walk(this.baseDir);
      return out;
    }
    return Array.from(this.blobs.keys()).filter((key) =>
      key.startsWith(prefix)
    );
  }

  private pathFor(key: string): string | null {
    if (!this.baseDir) return null;
    return path.join(this.baseDir, ...key.split('/').filter(Boolean));
  }
}
