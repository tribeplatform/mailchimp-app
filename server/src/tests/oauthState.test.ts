jest.mock('@/config', () => ({ CLIENT_SECRET: 'test-client-secret', LOG_DIR: '../logs', LOG_FORMAT: 'error' }));

import jwt from 'jsonwebtoken';
import { createOAuthState, isSafeStoredRedirect, sanitizeRedirect, verifyOAuthState } from '@/utils/oauthState';

describe('oauth state', () => {
  it('round-trips a signed state', () => {
    // Arrange
    const state = createOAuthState({ networkId: 'net-1', memberId: 'mem-1', redirect: 'https://community.example.com/manage' });

    // Act
    const result = verifyOAuthState(state);

    // Assert
    expect(result).toEqual({ networkId: 'net-1', memberId: 'mem-1', redirect: 'https://community.example.com/manage' });
  });

  it('rejects the legacy unsigned base64 state', () => {
    // Arrange
    const forged = Buffer.from(JSON.stringify({ n: 'victim-net', m: 'x', r: 'https://evil.example' }), 'ascii').toString('base64');

    // Act
    const result = verifyOAuthState(forged);

    // Assert
    expect(result).toBeNull();
  });

  it('rejects a state signed with another secret', () => {
    // Arrange
    const forged = jwt.sign({ n: 'victim-net', nonce: 'abc' }, 'other-secret', { audience: 'mailchimp-app:oauth-state', issuer: 'mailchimp-app' });

    // Act
    const result = verifyOAuthState(forged);

    // Assert
    expect(result).toBeNull();
  });

  it('rejects an expired state', () => {
    // Arrange
    const expired = jwt.sign({ n: 'net-1', nonce: 'abc', exp: Math.floor(Date.now() / 1000) - 60 }, 'test-client-secret', {
      audience: 'mailchimp-app:oauth-state',
      issuer: 'mailchimp-app',
    });

    // Act
    const result = verifyOAuthState(expired);

    // Assert
    expect(result).toBeNull();
  });

  it('rejects the settings-block jwt used as a state', () => {
    // Arrange
    const settingsJwt = jwt.sign({ sub: 'net-1', usr: 'mem-1', aud: 'https://api.example.com', iss: 'tribe-slack-app' }, 'test-client-secret');

    // Act
    const result = verifyOAuthState(settingsJwt);

    // Assert
    expect(result).toBeNull();
  });

  it('rejects a missing state', () => {
    // Arrange / Act / Assert
    expect(verifyOAuthState(undefined)).toBeNull();
    expect(verifyOAuthState('')).toBeNull();
    expect(verifyOAuthState(['a', 'b'])).toBeNull();
  });
});

describe('redirect validation', () => {
  it('accepts an https url on the community host', () => {
    // Act
    const result = sanitizeRedirect('https://community.example.com/manage/app-store/apps/kwrNURPZ0l0w', 'community.example.com');

    // Assert
    expect(result).toBe('https://community.example.com/manage/app-store/apps/kwrNURPZ0l0w');
  });

  it('accepts a community domain that includes a subfolder', () => {
    // Act
    const result = sanitizeRedirect('https://example.com/community/manage/app-store/apps/kwrNURPZ0l0w', 'example.com/community');

    // Assert
    expect(result).toBe('https://example.com/community/manage/app-store/apps/kwrNURPZ0l0w');
  });

  it.each([
    ['https://evil.example/manage', 'community.example.com'],
    ['https://community.example.com.evil.example/', 'community.example.com'],
    ['https://user:pass@community.example.com/', 'community.example.com'],
    ['http://community.example.com/manage', 'community.example.com'],
    ['javascript:alert(1)', 'community.example.com'],
    ['//evil.example/path', 'community.example.com'],
    ['/\\evil.example', 'community.example.com'],
    ['https://community.example.com/manage', undefined],
    ['not a url', 'community.example.com'],
  ])('rejects %s', (redirect, domain) => {
    // Act
    const result = sanitizeRedirect(redirect, domain);

    // Assert
    expect(result).toBeUndefined();
  });

  it('accepts a same-origin relative path', () => {
    // Act / Assert
    expect(sanitizeRedirect('/', undefined)).toBe('/');
  });

  it('re-checks stored redirects', () => {
    // Act / Assert
    expect(isSafeStoredRedirect('https://community.example.com/x')).toBe(true);
    expect(isSafeStoredRedirect('/')).toBe(true);
    expect(isSafeStoredRedirect('http://community.example.com/x')).toBe(false);
    expect(isSafeStoredRedirect('//evil.example')).toBe(false);
    expect(isSafeStoredRedirect(undefined)).toBe(false);
  });
});
