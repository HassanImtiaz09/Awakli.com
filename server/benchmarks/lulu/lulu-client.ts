/**
 * Lulu Print API Client
 *
 * OAuth2 client_credentials flow → print job creation → status monitoring.
 * Supports both sandbox and production environments.
 *
 * Wave 5A: Credentials pending from user. Module is functional but
 * requires LULU_CLIENT_KEY + LULU_CLIENT_SECRET env vars to operate.
 *
 * Blueprint: Stage 5.5 branch — Lulu Print Integration
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LuluConfig {
  clientKey: string;
  clientSecret: string;
  sandbox: boolean;
}

export interface LuluToken {
  accessToken: string;
  expiresAt: number; // Unix timestamp
}

export interface LuluShippingAddress {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  stateCode?: string;
  countryCode: string; // ISO 3166-1 alpha-2
  postcode: string;
  phoneNumber?: string;
  email?: string;
}

export interface LuluLineItem {
  title: string;
  cover: string; // URL to cover PDF
  interior: string; // URL to interior PDF
  podPackageId: string;
  quantity: number;
}

export interface LuluPrintJobInput {
  shippingAddress: LuluShippingAddress;
  shippingLevel: 'MAIL' | 'GROUND' | 'EXPEDITED' | 'EXPRESS';
  lineItems: LuluLineItem[];
  externalId?: string; // our internal order ID
  contactEmail: string;
}

export interface LuluPrintJob {
  id: number;
  status: LuluPrintJobStatus;
  lineItems: Array<{
    id: number;
    title: string;
    status: string;
    trackingId?: string;
    trackingUrls?: string[];
  }>;
  shippingAddress: LuluShippingAddress;
  costs?: {
    totalCostInclTax: string;
    totalTax: string;
    shippingCost: string;
    currency: string;
  };
  createdAt: string;
  updatedAt: string;
}

export type LuluPrintJobStatus =
  | 'CREATED'
  | 'UNPAID'
  | 'PAYMENT_IN_PROGRESS'
  | 'PRODUCTION_DELAYED'
  | 'PRODUCTION_READY'
  | 'IN_PRODUCTION'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'ERROR';

export interface LuluCostCalculation {
  totalCostExclTax: string;
  totalCostInclTax: string;
  totalTax: string;
  shippingCost: string;
  lineItemCosts: Array<{
    costExclTax: string;
    quantity: number;
  }>;
  currency: string;
}

export interface LuluCoverDimensions {
  width: number; // in inches
  height: number;
  spineWidth: number;
}

export interface LuluWebhookEvent {
  id: string;
  topic: 'PRINT_JOB_STATUS_CHANGED';
  data: {
    id: number;
    status: LuluPrintJobStatus;
    lineItems?: Array<{
      id: number;
      trackingId?: string;
      trackingUrls?: string[];
    }>;
  };
  timestamp: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SANDBOX_BASE_URL = 'https://api.sandbox.lulu.com';
const PRODUCTION_BASE_URL = 'https://api.lulu.com';
const TOKEN_ENDPOINT = '/auth/realms/glasstree/protocol/openid-connect/token';

// ─── Client ──────────────────────────────────────────────────────────────────

export class LuluClient {
  private config: LuluConfig;
  private token: LuluToken | null = null;
  private baseUrl: string;

  constructor(config: LuluConfig) {
    this.config = config;
    this.baseUrl = config.sandbox ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL;
  }

  /**
   * Get or refresh the OAuth2 access token.
   */
  async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.accessToken;
    }

    const tokenUrl = `${this.baseUrl}${TOKEN_ENDPOINT}`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientKey,
      client_secret: this.config.clientSecret,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Lulu auth failed (${response.status}): ${errorText}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.token = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    return this.token.accessToken;
  }

  /**
   * Make an authenticated request to the Lulu API.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Lulu API error (${response.status} ${method} ${path}): ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  // ─── Print Job Operations ─────────────────────────────────────────────────

  /**
   * Create a new print job.
   */
  async createPrintJob(input: LuluPrintJobInput): Promise<LuluPrintJob> {
    const payload = {
      contact_email: input.contactEmail,
      external_id: input.externalId,
      line_items: input.lineItems.map(item => ({
        title: item.title,
        cover: item.cover,
        interior: item.interior,
        pod_package_id: item.podPackageId,
        quantity: item.quantity,
      })),
      shipping_address: {
        name: input.shippingAddress.name,
        street1: input.shippingAddress.street1,
        street2: input.shippingAddress.street2,
        city: input.shippingAddress.city,
        state_code: input.shippingAddress.stateCode,
        country_code: input.shippingAddress.countryCode,
        postcode: input.shippingAddress.postcode,
        phone_number: input.shippingAddress.phoneNumber,
        email: input.shippingAddress.email,
      },
      shipping_level: input.shippingLevel,
    };

    const response = await this.request<any>('POST', '/print-jobs/', payload);

    return this.mapPrintJobResponse(response);
  }

  /**
   * Get a print job by ID.
   */
  async getPrintJob(printJobId: number): Promise<LuluPrintJob> {
    const response = await this.request<any>('GET', `/print-jobs/${printJobId}/`);
    return this.mapPrintJobResponse(response);
  }

  /**
   * Cancel a print job (only possible before production starts).
   */
  async cancelPrintJob(printJobId: number): Promise<void> {
    await this.request<any>('DELETE', `/print-jobs/${printJobId}/`);
  }

  // ─── Cost Calculation ─────────────────────────────────────────────────────

  /**
   * Calculate printing + shipping costs before creating a job.
   */
  async calculateCost(input: {
    lineItems: Array<{ podPackageId: string; quantity: number; pageCount: number }>;
    shippingAddress: { countryCode: string; stateCode?: string; postcode: string };
    shippingLevel: 'MAIL' | 'GROUND' | 'EXPEDITED' | 'EXPRESS';
  }): Promise<LuluCostCalculation> {
    const payload = {
      line_items: input.lineItems.map(item => ({
        pod_package_id: item.podPackageId,
        quantity: item.quantity,
        page_count: item.pageCount,
      })),
      shipping_address: {
        country_code: input.shippingAddress.countryCode,
        state_code: input.shippingAddress.stateCode,
        postcode: input.shippingAddress.postcode,
      },
      shipping_level: input.shippingLevel,
    };

    const response = await this.request<any>('POST', '/print-job-cost-calculations/', payload);

    return {
      totalCostExclTax: response.total_cost_excl_tax,
      totalCostInclTax: response.total_cost_incl_tax,
      totalTax: response.total_tax,
      shippingCost: response.shipping_cost?.total_cost_excl_tax ?? '0.00',
      lineItemCosts: (response.line_item_costs ?? []).map((c: any) => ({
        costExclTax: c.total_cost_excl_tax,
        quantity: c.quantity,
      })),
      currency: response.currency ?? 'USD',
    };
  }

  // ─── Cover Dimensions ─────────────────────────────────────────────────────

  /**
   * Get required cover dimensions for a given package and page count.
   */
  async getCoverDimensions(
    podPackageId: string,
    pageCount: number
  ): Promise<LuluCoverDimensions> {
    const response = await this.request<any>(
      'GET',
      `/print-jobs/cover-dimensions/?pod_package_id=${podPackageId}&page_count=${pageCount}`
    );

    return {
      width: response.width,
      height: response.height,
      spineWidth: response.spine_width,
    };
  }

  // ─── File Validation ──────────────────────────────────────────────────────

  /**
   * Validate an interior PDF file.
   */
  async validateInterior(fileUrl: string, podPackageId: string): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    try {
      const response = await this.request<any>('POST', '/print-job-file-validation/', {
        file_url: fileUrl,
        pod_package_id: podPackageId,
      });
      return { valid: true, errors: [] };
    } catch (err: any) {
      return { valid: false, errors: [err.message] };
    }
  }

  /**
   * Validate a cover PDF file.
   */
  async validateCover(fileUrl: string, podPackageId: string, pageCount: number): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    try {
      const response = await this.request<any>('POST', '/print-job-cover-file-validation/', {
        file_url: fileUrl,
        pod_package_id: podPackageId,
        page_count: pageCount,
      });
      return { valid: true, errors: [] };
    } catch (err: any) {
      return { valid: false, errors: [err.message] };
    }
  }

  // ─── Webhook Verification ─────────────────────────────────────────────────

  /**
   * Verify a Lulu webhook HMAC signature.
   */
  static verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean {
    // HMAC-SHA256 verification
    const crypto = require('crypto');
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private mapPrintJobResponse(response: any): LuluPrintJob {
    return {
      id: response.id,
      status: response.status?.name ?? response.status,
      lineItems: (response.line_items ?? []).map((li: any) => ({
        id: li.id,
        title: li.title,
        status: li.status?.name ?? li.status,
        trackingId: li.tracking_id,
        trackingUrls: li.tracking_urls,
      })),
      shippingAddress: {
        name: response.shipping_address?.name,
        street1: response.shipping_address?.street1,
        street2: response.shipping_address?.street2,
        city: response.shipping_address?.city,
        stateCode: response.shipping_address?.state_code,
        countryCode: response.shipping_address?.country_code,
        postcode: response.shipping_address?.postcode,
        phoneNumber: response.shipping_address?.phone_number,
        email: response.shipping_address?.email,
      },
      costs: response.costs ? {
        totalCostInclTax: response.costs.total_cost_incl_tax,
        totalTax: response.costs.total_tax,
        shippingCost: response.costs.shipping_cost?.total_cost_excl_tax ?? '0.00',
        currency: response.costs.currency ?? 'USD',
      } : undefined,
      createdAt: response.date_created ?? response.created_at,
      updatedAt: response.date_modified ?? response.updated_at,
    };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

let _luluClient: LuluClient | null = null;

/**
 * Get or create the Lulu client singleton.
 * Returns null if credentials are not configured.
 */
export function getLuluClient(): LuluClient | null {
  if (_luluClient) return _luluClient;

  const clientKey = process.env.LULU_CLIENT_KEY;
  const clientSecret = process.env.LULU_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    console.warn('[Lulu] LULU_CLIENT_KEY and LULU_CLIENT_SECRET not configured. Print integration disabled.');
    return null;
  }

  const sandbox = process.env.LULU_ENVIRONMENT !== 'production';

  _luluClient = new LuluClient({
    clientKey,
    clientSecret,
    sandbox,
  });

  return _luluClient;
}

/**
 * Reset the client singleton (for testing).
 */
export function resetLuluClient(): void {
  _luluClient = null;
}
