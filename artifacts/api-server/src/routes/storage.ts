import { Readable } from 'stream';
import { getAuth } from '@clerk/express';
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from '@workspace/api-zod';
import { Router, type IRouter, type Request, type Response } from 'express';

import {
  ObjectNotFoundError,
  ObjectStorageService,
} from '../lib/objectStorage';
import { ObjectPermission } from '../lib/objectAcl';
import { requireAuth, type AuthenticatedRequest } from '../middlewares/requireAuth';
import { validateProductImageContent } from './inventory-upload';

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 * Requires auth middleware so public callers cannot mint write-capable URLs.
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

    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath =
        objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, 'Error generating upload URL');
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  },
);

/**
 * POST /storage/uploads/finalize
 *
 * Marks a completed product-image upload as intentionally public. Objects that
 * were uploaded but never finalized remain private and cannot be downloaded.
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
      const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
      const [metadata] = await objectFile.getMetadata();
      const size = Number(metadata.size);
      const contentType = typeof metadata.contentType === 'string' ? metadata.contentType : '';
      if (!Number.isFinite(size) || size < 1 || size > 5 * 1024 * 1024) {
        await objectFile.delete({ ignoreNotFound: true });
        res.status(400).json({ error: 'The uploaded image exceeds the 5 MB limit' });
        return;
      }
      const [content] = await objectFile.download();
      try {
        validateProductImageContent(content, contentType);
      } catch {
        await objectFile.delete({ ignoreNotFound: true });
        res.status(400).json({ error: 'The uploaded object is not a valid supported image' });
        return;
      }
      await objectStorageService.trySetObjectEntityAclPolicy(objectPath, {
        owner: req.userId!,
        visibility: 'public',
      });
      res.json({ objectPath });
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: 'Object not found' });
        return;
      }
      req.log.error({ err: error }, 'Error finalizing product image');
      res.status(500).json({ error: 'Failed to finalize product image' });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get(
  '/storage/public-objects/*filePath',
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join('/') : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const response = await objectStorageService.downloadObject(file);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      req.log.error({ err: error }, 'Error serving public object');
      res.status(500).json({ error: 'Failed to serve public object' });
    }
  },
);

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get('/storage/objects/*path', async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile =
      await objectStorageService.getObjectEntityFile(objectPath);

    const auth = getAuth(req);
    const claimUserId = auth.sessionClaims?.userId;
    const userId = typeof claimUserId === 'string' ? claimUserId : auth.userId;
    const canAccess = await objectStorageService.canAccessObjectEntity({
      userId: userId ?? undefined,
      objectFile,
      requestedPermission: ObjectPermission.READ,
    });
    if (!canAccess) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      );
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, 'Object not found');
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    req.log.error({ err: error }, 'Error serving object');
    res.status(500).json({ error: 'Failed to serve object' });
  }
});

export default router;
