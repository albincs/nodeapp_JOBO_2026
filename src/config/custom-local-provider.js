import fs from 'fs';
import path from 'path';
import { BaseProvider } from '@adminjs/upload';

export class CustomLocalProvider extends BaseProvider {
  constructor(options) {
    super(options.bucket, options?.opts);
    if (!fs.existsSync(options.bucket)) {
      throw new Error(`directory: "${options.bucket}" does not exists. Create it before running LocalAdapter`);
    }
  }

  async upload(file, key) {
    const filePath = process.platform === 'win32' ? this.path(key) : this.path(key).slice(1);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fs.promises.rename(file.path, filePath);
    } catch (err) {
      // EXDEV occurs when moving across devices/mounts — fallback to copy+unlink
      if (err && err.code === 'EXDEV') {
        await fs.promises.copyFile(file.path, filePath);
        await fs.promises.unlink(file.path);
      } else {
        throw err;
      }
    }
  }

  async delete(key, bucket) {
    const fileLink = process.platform === 'win32' ? this.path(key, bucket) : this.path(key, bucket).slice(1);
    if (fs.existsSync(fileLink)) {
      await fs.promises.unlink(fileLink);
    }
  }

  path(key, bucket) {
    return process.platform === 'win32' ? `${path.join(bucket || this.bucket, key)}` : `/${path.join(bucket || this.bucket, key)}`;
  }
}

export default CustomLocalProvider;
