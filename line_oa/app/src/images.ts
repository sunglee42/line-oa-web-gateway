import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class ImageSender {
  constructor(private readonly tmpDir: string, private readonly maxFileBytes: number, private readonly maxTotalBytes: number) {}

  async init(): Promise<void> { await mkdir(this.tmpDir, { recursive: true, mode: 0o700 }); await this.cleanup(); }

  validate(buffer: Buffer, mime: string): void {
    if (!['image/jpeg', 'image/png'].includes(mime)) throw new Error('IMAGE_TYPE_NOT_ALLOWED');
    if (buffer.length === 0 || buffer.length > this.maxFileBytes) throw new Error('IMAGE_SIZE_LIMIT');
    const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if ((mime === 'image/jpeg' && !jpeg) || (mime === 'image/png' && !png)) throw new Error('IMAGE_SIGNATURE_INVALID');
  }

  async stage(buffer: Buffer, mime: string): Promise<string> {
    this.validate(buffer, mime);
    const current = await this.totalBytes();
    if (current + buffer.length > this.maxTotalBytes) throw new Error('TEMP_CAPACITY_LIMIT');
    const path = join(this.tmpDir, `${randomUUID()}${mime === 'image/png' ? '.png' : '.jpg'}`);
    await writeFile(path, buffer, { mode: 0o600, flag: 'wx' });
    return path;
  }

  async remove(path: string): Promise<void> { await unlink(path).catch(() => undefined); }
  async cleanup(): Promise<void> { for (const name of await readdir(this.tmpDir).catch(() => [] as string[])) await unlink(join(this.tmpDir, name)).catch(() => undefined); }
  async totalBytes(): Promise<number> { let total = 0; for (const name of await readdir(this.tmpDir).catch(() => [] as string[])) total += (await stat(join(this.tmpDir, name)).catch(() => ({ size: 0 }))).size; return total; }
}
