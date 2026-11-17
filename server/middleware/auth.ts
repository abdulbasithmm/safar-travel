import type { NextFunction, Request, Response } from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { serverEnv } from '../config/env.ts';

export interface AuthenticatedUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

function getFirebaseAdminApp() {
  if (getApps().length > 0) {
    return getApp();
  }

  if (!serverEnv.firebaseProjectId) {
    throw new Error('Firebase projectId is not configured on the server.');
  }

  return initializeApp({
    projectId: serverEnv.firebaseProjectId,
  });
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Authentication required. Please sign in to continue.',
      code: 'AUTH_MISSING_TOKEN',
    });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({
      error: 'Authentication token is empty.',
      code: 'AUTH_EMPTY_TOKEN',
    });
    return;
  }

  try {
    const adminApp = getFirebaseAdminApp();
    const decoded = await getAuth(adminApp).verifyIdToken(token);

    req.user = {
      uid: decoded.uid,
      email: decoded.email ?? null,
      emailVerified: Boolean(decoded.email_verified),
      name: typeof decoded.name === 'string' ? decoded.name : null,
    };

    next();
  } catch (error) {
    console.error(
      'Firebase token verification failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    res.status(401).json({
      error: 'Invalid or expired session token. Please sign in again.',
      code: 'AUTH_INVALID_TOKEN',
    });
  }
}
