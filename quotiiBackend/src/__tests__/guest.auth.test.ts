import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.JWT_REFRESH_EXPIRATION =
  process.env.JWT_REFRESH_EXPIRATION || '7d';

import { registerGuest, getUser } from '../repository/user.repository';
import { decodeAuthHeader } from '../utils/auth.util';
import { User, SignUpType } from '../database/schemas/user.schema';

// Guest users have no Apple Sign-In; these tests exercise the Backend auth
// seam (guest registration -> JWT -> authenticated request) with a faked
// User model, so no Mongo / Firebase / Apple flow is required.

const GUEST_ID = 'guest-fundamental-sleeper-42';

const fakeGuestUser = {
  _id: '507f1f77bcf86cd799439011',
  externalAuthId: GUEST_ID,
  signUpType: SignUpType.GUEST,
  isGuest: true,
  email: `guest_${GUEST_ID}@guest.quotii.local`,
};

beforeEach(() => {
  // Reset mocks between tests.
  delete (User as any).registerGuest;
  (User as any).findOneAndUpdate = undefined;
  (User as any).findById = undefined;
});

test('registerGuest creates a Mongo user marked as guest and returns a JWT', async () => {
  (User as any).findOneAndUpdate = async () => fakeGuestUser;

  const { accessToken, refreshToken, user } = await registerGuest(GUEST_ID);

  assert.ok(accessToken, 'access token should be returned');
  assert.ok(refreshToken, 'refresh token should be returned');
  assert.equal((user as any).isGuest, true, 'user should be marked as guest');
  assert.equal((user as any).signUpType, SignUpType.GUEST);
});

test('the guest JWT decodes as a valid authenticated request identity', async () => {
  (User as any).findOneAndUpdate = async () => fakeGuestUser;

  const { accessToken } = await registerGuest(GUEST_ID);
  const payload = await decodeAuthHeader(accessToken);

  assert.ok(payload, 'JWT should verify against JWT_ACCESS_SECRET');
  assert.equal(payload.id, fakeGuestUser._id, 'payload should carry the guest user id');
});

test('who-am-I / equivalent resolves the authenticated guest from the token', async () => {
  (User as any).findOneAndUpdate = async () => fakeGuestUser;
  (User as any).findById = () => ({ exec: async () => fakeGuestUser });

  const { accessToken } = await registerGuest(GUEST_ID);
  const payload = await decodeAuthHeader(accessToken);

  assert.ok(payload, 'authenticated request should carry a user identity');
  const whoami = await getUser(payload.id);
  assert.equal((whoami as any)._id, fakeGuestUser._id);
  assert.equal((whoami as any).isGuest, true);
});

test('registering with the same guest id reuses the same guest identity', async () => {
  const filters: unknown[] = [];
  (User as any).findOneAndUpdate = async (filter: unknown) => {
    filters.push(filter);
    return fakeGuestUser;
  };

  await registerGuest(GUEST_ID);
  await registerGuest(GUEST_ID);

  assert.equal(filters.length, 2, 'both registrations look up a user');
  assert.deepEqual(
    filters[0],
    filters[1],
    'a stable guestId maps to the same Mongo user (idempotent upsert)'
  );
});

test('registerGuest requires a guest id', async () => {
  await assert.rejects(() => registerGuest('' as any), /Guest id is required/);
});
