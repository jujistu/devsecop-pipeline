var admin = require('firebase-admin');
import { getMessaging, MulticastMessage } from 'firebase-admin/messaging';

let firebaseReady = false;

function firebaseDisabled(): boolean {
  const flag = (process.env.FIREBASE_ENABLED || '').trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'no') {
    return true;
  }
  const appEnv = (process.env.APP_ENV || process.env.NODE_ENV || '').trim().toLowerCase();
  return appEnv === 'test' || appEnv === 'ci';
}

function loadServiceAccountFromEnv():
  | {
      projectId: string;
      clientEmail: string;
      privateKey: string;
    }
  | null {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return { projectId, clientEmail, privateKey };
}

export function initFirebase() {
  if (firebaseDisabled()) {
    console.log('Firebase init skipped (test/disabled mode)');
    return;
  }

  const creds = loadServiceAccountFromEnv();
  if (!creds) {
    console.log(
      'Firebase credentials not configured; push notifications disabled'
    );
    return;
  }

  try {
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: creds.projectId,
          clientEmail: creds.clientEmail,
          privateKey: creds.privateKey,
        }),
      });
    }
    firebaseReady = true;
    console.log('firebase initialized');
  } catch (error) {
    firebaseReady = false;
    console.log('firebase init error', error);
  }
}

export const sendNotification = async (
  tokens: string[],
  title: string,
  content: string,
  imageUrl?: string,
  data?: {
    [key: string]: string;
  }
) => {
  if (!firebaseReady) {
    console.log('Firebase not initialized; notification skipped');
    return;
  }

  const multiCastMessage: MulticastMessage = {
    notification: {
      title: title,
      body: content,
      imageUrl: imageUrl,
    },
    data: data,
    tokens: tokens,
  };
  try {
    const res = await getMessaging().sendMulticast(multiCastMessage);
    console.log(JSON.stringify(res));
    return res;
  } catch (e) {
    console.error('sendFCMMessage error', e);
  }
};
