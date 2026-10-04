import { randomUUID } from 'crypto';
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from '@workspace/api-zod';
import express, { Router, type IRouter, type Request, type Response } from 'express';

import { getPublicImage, publishImage, saveImage } from '../lib/imageStore';
import { requireAuth, type AuthenticatedRequest } from '../middlewares/requireAuth';
import { validateProductImageContent } from './inventory-upload';
import { requireInventoryUser } from '../middlewares/requireInventoryUser';

const router: IRouter = Router();
router.use('/storage/uploads', requireInventoryUser);

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Vercel rejects function request bodies above 4.5 MB; the app shrinks photos before uploading.
const MAX_IMAGE_BYTES = Math.floor(4.5 * 1024 * 1024);

/**
 * POST /storage/uploads/request-url
 *
 * The client sends JSON metadata (name, size, contentType), NOT the file, and gets back the
 * address to PUT the file to plus the path it will be served from. Photos are stored in Postgres
 * (lib/imageStore.ts); there is no external bucket.
 */
router.post(
  '/storage/uploads/request-url',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing or invalid required fields' });
      return;
    }
    if (parsed.data.size > MAX_IMAGE_BYTES) {
      res.status(413).json({ error: 'La foto es demasiado pesada.' });
      return;
    }

    const id = randomUUID();
    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL: `/api/storage/uploads/${id}`,
        objectPath: `/objects/uploads/${id}`,
      }),
    );
  },
);

/**
 * PUT /storage/uploads/:id
 *
 * Receives the image bytes. The content is checked here (real file type, pixel limits) before
 * anything is stored; the photo stays private until /finalize publishes it.
 */
router.put(
  '/storage/uploads/:id',
  requireAuth,
  express.raw({ type: IMAGE_TYPES, limit: MAX_IMAGE_BYTES }),
  async (req: AuthenticatedRequest, res: Response) => {
    const id = String(req.params.id);
    const contentType = req.is(IMAGE_TYPES);
    if (!IMAGE_ID.test(id) || !contentType) {
      res.status(400).json({ error: 'Invalid upload request' });
      return;
    }
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body) || body.length < 1) {
      res.status(400).json({ error: 'The uploaded image is empty' });
      return;
    }
    try {
      validateProductImageContent(body, contentType);
    } catch {
      res.status(400).json({ error: 'The uploaded object is not a valid supported image' });
      return;
    }

    try {
      const saved = await saveImage(id, contentType, body, req.userId!);
      if (!saved) {
        res.status(409).json({ error: 'This upload can no longer be replaced' });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      req.log.error({ err: error }, 'Error saving product image');
      res.status(500).json({ error: 'Failed to save product image' });
    }
  },
);

/**
 * POST /storage/uploads/finalize
 *
 * Marks a completed product-image upload as published. Uploads that were never finalized remain
 * private and are not served.
 */
router.post(
  '/storage/uploads/finalize',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const objectPath = typeof req.body?.objectPath === 'string' ? req.body.objectPath : '';
    if (!/^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(objectPath)) {
      res.status(400).json({ error: 'Invalid object path' });
      return;
    }

    try {
      const published = await publishImage(objectPath.slice('/objects/uploads/'.length), req.userId!);
      if (!published) {
        res.status(404).json({ error: 'Object not found' });
        return;
      }
      res.json({ objectPath });
    } catch (error) {
      req.log.error({ err: error }, 'Error finalizing product image');
      res.status(500).json({ error: 'Failed to finalize product image' });
    }
  },
);

/**
 * GET /storage/objects/uploads/:id
 *
 * Serves a published product photo. The id is an unguessable UUID, same as before.
 */
router.get('/storage/objects/*path', async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
    const match = /^uploads\/([0-9a-f-]{36})$/i.exec(wildcardPath);
    const image = match && IMAGE_ID.test(match[1]) ? await getPublicImage(match[1]) : null;
    if (!image) {
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    res.setHeader('Content-Type', image.contentType);
    res.setHeader('Content-Length', String(image.data.length));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(image.data);
  } catch (error) {
    req.log.error({ err: error }, 'Error serving object');
    res.status(500).json({ error: 'Failed to serve object' });
  }
});

export default router;
