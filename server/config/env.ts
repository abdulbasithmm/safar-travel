import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

export interface FirebasePublicConfig {
  projectId: string;
  firestoreDatabaseId: string;
}

function loadFirebaseConfig(): FirebasePublicConfig {
  const candidates = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
  ];
  if (typeof import.meta !== 'undefined' && typeof import.meta.url === 'string' && import.meta.url) {
    candidates.push(
      path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../firebase-applet-config.json',
      ),
    );
  }

  const configPath = candidates.find((candidate) => fs.existsSync(candidate));
  const fallbackProjectId =
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.VITE_FIREBASE_PROJECT_ID?.trim() ||
    '';
  const fallbackDbId =
    process.env.FIRESTORE_DATABASE_ID?.trim() || '(default)';

  if (!configPath) {
    return {
      projectId: fallbackProjectId,
      firestoreDatabaseId: fallbackDbId,
    };
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<FirebasePublicConfig>;
  return {
    projectId: parsed.projectId || fallbackProjectId,
    firestoreDatabaseId: parsed.firestoreDatabaseId || fallbackDbId,
  };
}

const firebaseConfig = loadFirebaseConfig();

export function getOpenAiApiKey(): string {
  return process.env.OPENAI_API_KEY?.trim() || '';
}

export function getOpenAiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
}

export function getUnsplashAccessKey(): string {
  return process.env.UNSPLASH_ACCESS_KEY?.trim() || '';
}

export function getPexelsApiKey(): string {
  return process.env.PEXELS_API_KEY?.trim() || '';
}

export const serverEnv = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT) || 3000,
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  get openAiApiKey(): string {
    return getOpenAiApiKey();
  },
  get openAiModel(): string {
    return getOpenAiModel();
  },
  get unsplashAccessKey(): string {
    return getUnsplashAccessKey();
  },
  get pexelsApiKey(): string {
    return getPexelsApiKey();
  },
  firebaseProjectId: firebaseConfig.projectId,
  firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
} as const;
