import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

export interface FirebasePublicConfig {
  projectId: string;
  firestoreDatabaseId: string;
}

function loadFirebaseConfig(): FirebasePublicConfig {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (!fs.existsSync(configPath)) {
    return {
      projectId: process.env.FIREBASE_PROJECT_ID || '',
      firestoreDatabaseId: process.env.FIRESTORE_DATABASE_ID || '(default)',
    };
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<FirebasePublicConfig>;
  return {
    projectId: parsed.projectId || process.env.FIREBASE_PROJECT_ID || '',
    firestoreDatabaseId:
      parsed.firestoreDatabaseId || process.env.FIRESTORE_DATABASE_ID || '(default)',
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
