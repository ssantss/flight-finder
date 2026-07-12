import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendWhatsAppAlert } from './whatsapp-alert';
import type { ChannelMessage } from './channels/types';

const MESSAGE: ChannelMessage = {
  title: 'New low: MDE to MIA',
  body: 'MDE to MIA dropped.',
  url: 'https://ff.example/q/abc',
  data: {
    queryId: 'abc',
    origin: 'MDE',
    destination: 'MIA',
    airline: 'Avianca',
    currentMin: 1180000,
    baseline: 1450000,
    drop: 270000,
    currency: 'COP',
    travelDate: '2026-09-15',
    chartUrl: 'https://ff.example/q/abc',
    bookingUrl: 'https://google.com/travel',
  },
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }));
  vi.stubGlobal('fetch', fetchMock);
  process.env.WHATSAPP_API_URL = 'http://localhost:3077';
  process.env.WHATSAPP_API_KEY = 'test-key';
  process.env.WHATSAPP_ACCOUNT = 'apuestas';
  process.env.WHATSAPP_ALERT_GROUP_ID = '123@g.us';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHATSAPP_API_URL;
  delete process.env.WHATSAPP_API_KEY;
  delete process.env.WHATSAPP_ACCOUNT;
  delete process.env.WHATSAPP_ALERT_GROUP_ID;
});

describe('sendWhatsAppAlert', () => {
  it('returns null (no-op) when any env var is missing', async () => {
    delete process.env.WHATSAPP_ALERT_GROUP_ID;
    expect(await sendWhatsAppAlert(MESSAGE)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to the group endpoint with the configured account and group', async () => {
    const ok = await sendWhatsAppAlert(MESSAGE);
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://localhost:3077/api/groups/send-message');
    expect(init.method).toBe('POST');
    expect(init.headers['X-API-Key']).toBe('test-key');
    const payload = JSON.parse(init.body);
    expect(payload.account).toBe('apuestas');
    expect(payload.groupId).toBe('123@g.us');
    expect(payload.message).toContain('MDE → MIA');
    expect(payload.message).toContain('Avianca');
    expect(payload.message).toContain('2026-09-15');
    expect(payload.message).toContain('https://google.com/travel');
  });

  it('returns false when the API rejects', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' });
    expect(await sendWhatsAppAlert(MESSAGE)).toBe(false);
  });

  it('returns false when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    expect(await sendWhatsAppAlert(MESSAGE)).toBe(false);
  });
});
