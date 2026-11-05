import type { RequestHandler } from 'express';
import multer from 'multer';
import { CustomError } from '../errors/index.js';

export type ImageExtension = '.jpg' | '.png' | '.webp';

// File signatures ("magic bytes"); null matches any byte. The file name and Content-Type a client
// sends are only claims, and stored files are served back from this origin, so an HTML or SVG file
// passed off as an image would run as a page. Only content that really is an image is accepted.
const IMAGE_SIGNATURES: { extension: ImageExtension; signature: (number | null)[] }[] = [
  { extension: '.jpg', signature: [0xff, 0xd8, 0xff] },
  { extension: '.png', signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // "RIFF", the chunk size, then "WEBP"
  {
    extension: '.webp',
    signature: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
  },
];

/** The extension matching the file's actual format, or null when it is not a supported image. */
export const detectImageExtension = (data: Buffer): ImageExtension | null =>
  IMAGE_SIGNATURES.find(
    ({ signature }) =>
      data.length >= signature.length &&
      signature.every((byte, index) => byte === null || data[index] === byte),
  )?.extension ?? null;

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Accepts one file in `field` and keeps it in memory until its content has been checked, so nothing
 * unverified reaches the disk. Upload problems become 400 responses with a specific code.
 */
export const uploadImage = (
  field: string,
  { maxBytes = DEFAULT_MAX_BYTES }: { maxBytes?: number } = {},
): RequestHandler => {
  const single = multer({
    storage: multer.memoryStorage(),
    // One file and nothing else: text fields would otherwise be buffered in memory without a cap
    limits: { fileSize: maxBytes, files: 1, fields: 0, parts: 1 },
  }).single(field);

  return (req, res, next) => {
    single(req, res, (error?: unknown) => {
      if (!error) {
        next();
        return;
      }
      // The file is held in memory, so every error here comes from the request itself
      const tooLarge = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
      next(new CustomError(400, tooLarge ? 'upload.file_too_large' : 'upload.invalid_file'));
    });
  };
};
