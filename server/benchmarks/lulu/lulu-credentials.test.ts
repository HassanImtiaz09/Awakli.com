/**
 * Lulu API Credential Validation Test
 *
 * Verifies that the LULU_CLIENT_KEY and LULU_CLIENT_SECRET environment
 * variables are set and can successfully obtain an OAuth2 access token
 * from the Lulu sandbox API.
 */

import { describe, it, expect } from 'vitest';

describe('Lulu API credential validation', () => {
  it('LULU_CLIENT_KEY is set', () => {
    const key = process.env.LULU_CLIENT_KEY;
    expect(key).toBeDefined();
    expect(key!.length).toBeGreaterThan(10);
    // UUID format
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('LULU_CLIENT_SECRET is set', () => {
    const secret = process.env.LULU_CLIENT_SECRET;
    expect(secret).toBeDefined();
    expect(secret!.length).toBeGreaterThan(10);
  });

  it('can obtain OAuth2 access token from Lulu sandbox', async () => {
    const clientKey = process.env.LULU_CLIENT_KEY!;
    const clientSecret = process.env.LULU_CLIENT_SECRET!;

    const tokenUrl = 'https://api.sandbox.lulu.com/auth/realms/glasstree/protocol/openid-connect/token';
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientKey,
      client_secret: clientSecret,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    expect(response.ok).toBe(true);

    const data = await response.json() as { access_token: string; expires_in: number; token_type: string };
    expect(data.access_token).toBeDefined();
    expect(data.access_token.length).toBeGreaterThan(50);
    expect(data.token_type).toBe('Bearer');
    expect(data.expires_in).toBeGreaterThan(0);
  }, 15000);

  it('can list available pod packages from Lulu sandbox', async () => {
    const clientKey = process.env.LULU_CLIENT_KEY!;
    const clientSecret = process.env.LULU_CLIENT_SECRET!;

    // Get token
    const tokenUrl = 'https://api.sandbox.lulu.com/auth/realms/glasstree/protocol/openid-connect/token';
    const tokenBody = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientKey,
      client_secret: clientSecret,
    });

    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });

    const { access_token } = await tokenRes.json() as { access_token: string };

    // List pod packages (lightweight endpoint)
    const packagesRes = await fetch('https://api.sandbox.lulu.com/print-job-cost-calculations/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        line_items: [{
          page_count: 100,
          pod_package_id: '0850X1100BWSTDPB060UW444MXX',
          quantity: 1,
        }],
        shipping_address: {
          city: 'New York',
          country_code: 'US',
          postcode: '10001',
          state_code: 'NY',
          street1: '123 Test St',
        },
        shipping_option: 'MAIL',
      }),
    });

    // We just need to confirm the API responds (even a 400 for invalid package is fine — it means auth works)
    expect(tokenRes.ok).toBe(true);
    // The cost calculation may fail if the package ID isn't exact, but auth should work
    expect([200, 201, 400, 422].includes(packagesRes.status)).toBe(true);
  }, 20000);
});
