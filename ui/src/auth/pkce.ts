/**
 * Manual PKCE (S256) auth flow for Cognito Hosted UI.
 *
 * RFC 7636 requires:
 * - code_verifier: 43-128 chars from [A-Za-z0-9-._~]
 * - code_challenge: BASE64URL(SHA256(code_verifier))
 * - code_challenge_method: S256
 */

// Normalize domain: strip any leading https:// so we always build it ourselves
const rawDomain = import.meta.env.VITE_COGNITO_DOMAIN ?? '';
const COGNITO_DOMAIN = rawDomain.replace(/^https?:\/\//, '');

const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID ?? '';
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_SIGN_IN ?? 'http://localhost:5173/';
const SIGN_OUT_URI = import.meta.env.VITE_REDIRECT_SIGN_OUT ?? 'http://localhost:5173/';

const VERIFIER_KEY = 'pkce_code_verifier';
const TOKENS_KEY = 'auth_tokens';
const LOGIN_IN_PROGRESS_KEY = 'pkce_login_in_progress';

interface AuthTokens {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_at: number;
}

// --- PKCE helpers (RFC 7636 compliant) ---

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return bufferToBase64Url(array.buffer);
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  return bufferToBase64Url(digest);
}

// --- Token storage ---

function getStoredTokens(): AuthTokens | null {
  try {
    const raw = sessionStorage.getItem(TOKENS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthTokens;
  } catch {
    return null;
  }
}

function storeTokens(tokens: AuthTokens): void {
  sessionStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
}

function clearTokens(): void {
  sessionStorage.removeItem(TOKENS_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(LOGIN_IN_PROGRESS_KEY);
}

// --- Public API ---

/**
 * Build the authorize URL without redirecting — for debugging.
 */
export async function getDebugAuthorizeUrl(): Promise<string> {
  const verifier = generateCodeVerifier();
  // Store it so login() can reuse it
  sessionStorage.setItem(VERIFIER_KEY, verifier);

  const challenge = await generateCodeChallenge(verifier);

  const baseUrl = `https://${COGNITO_DOMAIN}/oauth2/authorize`;
  const params = new URLSearchParams();
  params.set('response_type', 'code');
  params.set('client_id', CLIENT_ID);
  params.set('redirect_uri', REDIRECT_URI);
  params.set('scope', 'openid email profile');
  params.set('code_challenge', challenge);
  params.set('code_challenge_method', 'S256');

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Redirect to Cognito Hosted UI with PKCE code_challenge.
 * Guards against double-redirect with a sessionStorage flag.
 */
export async function login(): Promise<void> {
  // Prevent double-redirect if login is already in progress
  if (sessionStorage.getItem(LOGIN_IN_PROGRESS_KEY)) {
    console.log('[PKCE] Login already in progress, skipping redirect');
    return;
  }

  const verifier = generateCodeVerifier();
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(LOGIN_IN_PROGRESS_KEY, '1');

  const challenge = await generateCodeChallenge(verifier);

  // Build authorize URL — always use https:// + bare domain
  const baseUrl = `https://${COGNITO_DOMAIN}/oauth2/authorize`;
  const params = new URLSearchParams();
  params.set('response_type', 'code');
  params.set('client_id', CLIENT_ID);
  params.set('redirect_uri', REDIRECT_URI);
  params.set('scope', 'openid email profile');
  params.set('code_challenge', challenge);
  params.set('code_challenge_method', 'S256');

  const fullUrl = `${baseUrl}?${params.toString()}`;

  console.log('[PKCE] Verifier:', verifier);
  console.log('[PKCE] Verifier length:', verifier.length);
  console.log('[PKCE] Challenge:', challenge);
  console.log('[PKCE] Redirect URI:', REDIRECT_URI);
  console.log('[PKCE] Authorize URL:', fullUrl);

  window.location.href = fullUrl;
}

/**
 * Handle the callback: exchange authorization code for tokens.
 */
export async function handleCallback(): Promise<boolean> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  // Clear the login-in-progress flag on any callback
  sessionStorage.removeItem(LOGIN_IN_PROGRESS_KEY);

  if (error) {
    const errorDesc = url.searchParams.get('error_description') ?? '';
    console.error('[PKCE] Cognito returned error:', error, errorDesc);
    clearTokens();
    window.history.replaceState({}, '', url.pathname);
    return false;
  }

  if (!code) return false;

  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) {
    console.error('[PKCE] code_verifier missing from sessionStorage');
    window.history.replaceState({}, '', url.pathname);
    return false;
  }

  console.log('[PKCE] Exchanging code for tokens...');

  const tokenUrl = `https://${COGNITO_DOMAIN}/oauth2/token`;
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('client_id', CLIENT_ID);
  body.set('code', code);
  body.set('redirect_uri', REDIRECT_URI);
  body.set('code_verifier', verifier);

  try {
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[PKCE] Token exchange failed:', resp.status, errText);
      clearTokens();
      window.history.replaceState({}, '', url.pathname);
      return false;
    }

    const data = await resp.json();
    storeTokens({
      access_token: data.access_token,
      id_token: data.id_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
    });
    sessionStorage.removeItem(VERIFIER_KEY);
    window.history.replaceState({}, '', url.pathname);
    console.log('[PKCE] Authenticated successfully');
    return true;
  } catch (err) {
    console.error('[PKCE] Network error during token exchange:', err);
    clearTokens();
    window.history.replaceState({}, '', url.pathname);
    return false;
  }
}

// --- Token refresh ---

async function refreshAccessToken(): Promise<boolean> {
  const tokens = getStoredTokens();
  if (!tokens?.refresh_token) return false;

  const tokenUrl = `https://${COGNITO_DOMAIN}/oauth2/token`;
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('client_id', CLIENT_ID);
  body.set('refresh_token', tokens.refresh_token);

  try {
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      console.error('[PKCE] Token refresh failed:', resp.status);
      clearTokens();
      login();
      return false;
    }

    const data = await resp.json();
    storeTokens({
      access_token: data.access_token,
      id_token: data.id_token,
      refresh_token: tokens.refresh_token, // Cognito doesn't return a new refresh token
      expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
    });
    console.log('[PKCE] Token refreshed successfully');
    return true;
  } catch (err) {
    console.error('[PKCE] Network error during token refresh:', err);
    clearTokens();
    login();
    return false;
  }
}

const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

async function ensureFreshToken(): Promise<void> {
  const tokens = getStoredTokens();
  if (!tokens) return;

  const timeUntilExpiry = tokens.expires_at - Date.now();
  if (timeUntilExpiry <= REFRESH_THRESHOLD_MS && tokens.refresh_token) {
    await refreshAccessToken();
  }
}

export function getAccessToken(): string | null {
  const tokens = getStoredTokens();
  if (!tokens) return null;
  if (Date.now() >= tokens.expires_at) {
    clearTokens();
    return null;
  }
  // Trigger async refresh if near expiry (non-blocking)
  const timeUntilExpiry = tokens.expires_at - Date.now();
  if (timeUntilExpiry <= REFRESH_THRESHOLD_MS && tokens.refresh_token) {
    ensureFreshToken();
  }
  return tokens.access_token;
}

export function getIdToken(): string | null {
  const tokens = getStoredTokens();
  if (!tokens) return null;
  if (Date.now() >= tokens.expires_at) {
    clearTokens();
    return null;
  }
  return tokens.id_token;
}

export function isAuthenticated(): boolean {
  return getAccessToken() !== null;
}

export function getUserInfo(): { email?: string; groups?: string[] } | null {
  const idToken = getIdToken();
  if (!idToken) return null;
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(payload));
    return {
      email: decoded.email,
      groups: decoded['cognito:groups'],
    };
  } catch {
    return null;
  }
}

export function logout(): void {
  clearTokens();
  // Just clear and reload — no hosted UI redirect needed
  window.location.href = '/';
}

// --- Direct sign-in (USER_PASSWORD_AUTH) ---

const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID ?? '';
const COGNITO_REGION = USER_POOL_ID.split('_')[0] || 'eu-west-2';

export async function signInWithPassword(email: string, password: string): Promise<{ success: boolean; error?: string; newPasswordRequired?: boolean }> {
  const endpoint = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
      },
      body: JSON.stringify({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: CLIENT_ID,
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password,
        },
      }),
    });

    const data = await resp.json();

    if (data.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
      // Store session for respondToAuthChallenge
      sessionStorage.setItem('cognito_challenge_session', data.Session);
      sessionStorage.setItem('cognito_challenge_username', email);
      return { success: false, newPasswordRequired: true };
    }

    if (!resp.ok || !data.AuthenticationResult) {
      const msg = data.message || data.__type || 'Authentication failed';
      return { success: false, error: msg };
    }

    const result = data.AuthenticationResult;
    storeTokens({
      access_token: result.AccessToken,
      id_token: result.IdToken,
      refresh_token: result.RefreshToken,
      expires_at: Date.now() + (result.ExpiresIn ?? 3600) * 1000,
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: 'Network error. Please try again.' };
  }
}

export async function respondNewPassword(newPassword: string): Promise<{ success: boolean; error?: string }> {
  const session = sessionStorage.getItem('cognito_challenge_session');
  const username = sessionStorage.getItem('cognito_challenge_username');
  if (!session || !username) return { success: false, error: 'Session expired. Please sign in again.' };

  const endpoint = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.RespondToAuthChallenge',
      },
      body: JSON.stringify({
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        ClientId: CLIENT_ID,
        Session: session,
        ChallengeResponses: {
          USERNAME: username,
          NEW_PASSWORD: newPassword,
        },
      }),
    });

    const data = await resp.json();

    if (!resp.ok || !data.AuthenticationResult) {
      return { success: false, error: data.message || 'Failed to set new password' };
    }

    const result = data.AuthenticationResult;
    storeTokens({
      access_token: result.AccessToken,
      id_token: result.IdToken,
      refresh_token: result.RefreshToken,
      expires_at: Date.now() + (result.ExpiresIn ?? 3600) * 1000,
    });

    sessionStorage.removeItem('cognito_challenge_session');
    sessionStorage.removeItem('cognito_challenge_username');
    return { success: true };
  } catch {
    return { success: false, error: 'Network error. Please try again.' };
  }
}

// --- Password validation ---

export function validatePassword(password: string): { valid: boolean; message?: string } {
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least 1 uppercase letter.' };
  }
  if (!/\d/.test(password)) {
    return { valid: false, message: 'Password must contain at least 1 digit.' };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least 1 symbol.' };
  }
  return { valid: true };
}

// --- Forgot Password ---

export async function forgotPassword(email: string): Promise<{ success: boolean; error?: string }> {
  const endpoint = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.ForgotPassword',
      },
      body: JSON.stringify({
        ClientId: CLIENT_ID,
        Username: email,
      }),
    });

    if (!resp.ok) {
      const data = await resp.json();
      return { success: false, error: data.message || data.__type || 'Failed to send reset code.' };
    }

    return { success: true };
  } catch {
    return { success: false, error: 'Network error. Please try again.' };
  }
}

export async function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<{ success: boolean; error?: string }> {
  const endpoint = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.ConfirmForgotPassword',
      },
      body: JSON.stringify({
        ClientId: CLIENT_ID,
        Username: email,
        ConfirmationCode: code,
        Password: newPassword,
      }),
    });

    if (!resp.ok) {
      const data = await resp.json();
      return { success: false, error: data.message || data.__type || 'Failed to reset password.' };
    }

    return { success: true };
  } catch {
    return { success: false, error: 'Network error. Please try again.' };
  }
}
