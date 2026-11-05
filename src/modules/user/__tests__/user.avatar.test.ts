import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storage } from '../../../lib/storage.js';
import { setupTestDatabase } from '../../../test/helpers/database.js';
import * as userController from '../user.controller.js';
import User from '../user.model.js';
import { updateAvatar } from '../user.service.js';

vi.mock('../../../jobs/queues.js', () => ({
  purgeQueue: { add: vi.fn(), getJob: vi.fn() },
}));

setupTestDatabase();

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

const fileOf = (buffer: Buffer, originalname = 'photo.png'): Express.Multer.File =>
  ({ buffer, originalname, mimetype: 'image/png', size: buffer.length }) as Express.Multer.File;

let userId: string;

beforeEach(async () => {
  vi.restoreAllMocks();
  const user = await User.create({
    email: 'avatar@example.com',
    password: 'not-a-real-hash',
    name: 'Ava',
    surname: 'Tar',
  });
  userId = user._id.toString();
});

describe('updateAvatar', () => {
  it('rejects a file whose content is not an image even if it is named .png', async () => {
    const save = vi.spyOn(storage, 'save');

    await expect(
      updateAvatar(userId, fileOf(Buffer.from('<html><script>alert(1)</script></html>'))),
    ).rejects.toMatchObject({ statusCode: 400, message: 'upload.only_images' });
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects an empty file', async () => {
    const save = vi.spyOn(storage, 'save');

    await expect(updateAvatar(userId, fileOf(Buffer.alloc(0)))).rejects.toMatchObject({
      message: 'upload.only_images',
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('stores a real image and records where it is served', async () => {
    vi.spyOn(storage, 'save').mockResolvedValue('/uploads/new-avatar.png');

    const user = await updateAvatar(userId, fileOf(PNG));

    expect(storage.save).toHaveBeenCalledWith(PNG, '.png');
    expect(user.photoUrl).toBe('/uploads/new-avatar.png');
  });

  it('keeps answering 400 user.avatar_required when no file is sent', async () => {
    const req = { user: { id: userId, role: 'user' }, file: undefined } as unknown as Request;

    await expect(userController.updateAvatar(req, {} as Response)).rejects.toMatchObject({
      statusCode: 400,
      message: 'user.avatar_required',
    });
  });
});
