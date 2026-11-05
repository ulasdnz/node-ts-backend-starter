import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Where uploaded files live. The local disk implements it today; an object store such as GCS or S3
 * can implement the same port for deployments whose filesystem is ephemeral (Cloud Run).
 */
export interface FileStorage {
  /** Stores `data` under a new random name and returns the path it is served at. */
  save(data: Buffer, extension: string): Promise<string>;
  /** Deletes a file `save` returned. A file that is already gone is not an error. */
  remove(publicPath: string): Promise<void>;
}

export interface LocalDiskStorageOptions {
  directory: string;
  publicBasePath: string;
}

export const createLocalDiskStorage = ({
  directory,
  publicBasePath,
}: LocalDiskStorageOptions): FileStorage => ({
  async save(data, extension) {
    const filename = `${randomUUID()}${extension}`;
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, filename), data);
    return `${publicBasePath}/${filename}`;
  },

  async remove(publicPath) {
    // Only the file name is used, so a crafted path cannot reach outside the storage directory
    const filename = path.basename(publicPath);
    try {
      await unlink(path.join(directory, filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  },
});

export const UPLOADS_DIRECTORY = 'uploads';

export const storage = createLocalDiskStorage({
  directory: UPLOADS_DIRECTORY,
  publicBasePath: '/uploads',
});
