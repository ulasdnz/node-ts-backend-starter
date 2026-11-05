import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'winston';
import { createErrorHandler } from '../error-handler.js';
import { detectImageExtension, uploadImage } from '../upload.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 '),
]);

describe('detectImageExtension', () => {
  it('recognises jpg, png and webp by their signatures', () => {
    expect(detectImageExtension(JPG)).toBe('.jpg');
    expect(detectImageExtension(PNG)).toBe('.png');
    expect(detectImageExtension(WEBP)).toBe('.webp');
  });

  it('rejects content that only claims to be an image', () => {
    const disguised = [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      Buffer.from('<html><script>alert(1)</script></html>'),
      Buffer.alloc(0),
      PNG.subarray(0, 4),
    ];

    for (const data of disguised) {
      expect(detectImageExtension(data)).toBeNull();
    }
  });
});

describe('uploadImage', () => {
  const buildApp = (maxBytes?: number) => {
    const app = express();
    app.post('/avatar', uploadImage('photo', { maxBytes }), (req, res) => {
      res.json({ size: req.file?.size });
    });
    app.use(
      createErrorHandler({
        logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as unknown as Logger,
        nodeEnv: 'test',
      }),
    );
    return app;
  };

  it('keeps the uploaded file in memory for the handler', async () => {
    const res = await request(buildApp()).post('/avatar').attach('photo', PNG, 'photo.png');

    expect(res.status).toBe(200);
    expect(res.body.size).toBe(PNG.length);
  });

  it('rejects files over the size limit with upload.file_too_large', async () => {
    const res = await request(buildApp(8))
      .post('/avatar')
      .attach('photo', Buffer.alloc(16), 'big.png');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('upload.file_too_large');
  });

  it('rejects unexpected fields with upload.invalid_file', async () => {
    const res = await request(buildApp()).post('/avatar').attach('other', PNG, 'photo.png');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('upload.invalid_file');
  });
});
