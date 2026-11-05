import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalDiskStorage } from '../storage.js';

let root: string;
let directory: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'storage-test-'));
  directory = path.join(root, 'uploads');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('createLocalDiskStorage', () => {
  it('does not touch the disk until the first save', async () => {
    createLocalDiskStorage({ directory, publicBasePath: '/uploads' });

    expect(await readdir(root)).toEqual([]);
  });

  it('saves the file under a random name and returns its public path', async () => {
    const storage = createLocalDiskStorage({ directory, publicBasePath: '/uploads' });
    const data = Buffer.from('image-bytes');

    const publicPath = await storage.save(data, '.png');

    expect(publicPath).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/);
    expect(await readFile(path.join(directory, path.basename(publicPath)))).toEqual(data);
  });

  it('only deletes inside the storage directory', async () => {
    const storage = createLocalDiskStorage({ directory, publicBasePath: '/uploads' });
    const outside = path.join(root, 'secret.txt');
    await writeFile(outside, 'keep me');
    await storage.save(Buffer.from('x'), '.png');

    await storage.remove('/uploads/../secret.txt');

    expect(await readFile(outside, 'utf8')).toBe('keep me');
  });

  it('ignores files that are already gone', async () => {
    const storage = createLocalDiskStorage({ directory, publicBasePath: '/uploads' });

    await expect(storage.remove('/uploads/missing.png')).resolves.toBeUndefined();
  });
});
