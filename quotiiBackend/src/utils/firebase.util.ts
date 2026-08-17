var admin = require('firebase-admin');
// NOTE: firebase-admin 14 deprecated MulticastMessage (tokens-based) in favour of
// FidMulticastMessage (fids-based). This function is not currently called — the live
// notification path uses expo.util.ts. The signature accepts fids so the implementation
// is ready for when the mobile client is updated to supply Firebase Installation IDs.
// TODO: wire the mobile client to pass FIDs via the updateUserDeviceToken mutation.
import { getMessaging, FidMulticastMessage } from 'firebase-admin/messaging';

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
  fids: string[],
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

  const multiCastMessage: FidMulticastMessage = {
    notification: {
      title: title,
      body: content,
      imageUrl: imageUrl,
    },
    data: data,
    fids: fids,
  };
  try {
    const res = await getMessaging().sendEachForMulticast(multiCastMessage);
    console.log(JSON.stringify(res));
    return res;
  } catch (e) {
    console.error('sendFCMMessage error', e);
  }
};
