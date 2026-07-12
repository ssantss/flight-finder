import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFindMany = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: { whatsAppAlert: { findMany: (...args: unknown[]) => mockFindMany(...args) } },
}));

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
    chartUrl: 'https://tailnet.example/q/abc',
    bookingUrl: 'https://google.com/travel',
  },
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockFindMany.mockResolvedValue([]);
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
  it('returns null (no-op) when transport env is missing', async () => {
    delete process.env.WHATSAPP_API_KEY;
    expect(await sendWhatsAppAlert('abc', MESSAGE)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when neither a group nor any phone is configured', async () => {
    delete process.env.WHATSAPP_ALERT_GROUP_ID;
    mockFindMany.mockResolvedValue([]);
    expect(await sendWhatsAppAlert('abc', MESSAGE)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to the group with the full message including the chart link', async () => {
    const ok = await sendWhatsAppAlert('abc', MESSAGE);
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://localhost:3077/api/groups/send-message');
    const payload = JSON.parse(init.body);
    expect(payload.account).toBe('apuestas');
    expect(payload.groupId).toBe('123@g.us');
    expect(payload.message).toContain('MDE → MIA');
    expect(payload.message).toContain('https://tailnet.example/q/abc');
    expect(payload.message).toContain('https://google.com/travel');
  });

  it('also posts to each per-tracker phone WITHOUT the private chart link', async () => {
    mockFindMany.mockResolvedValue([{ phone: '573001112233' }, { phone: '573004445566' }]);
    const ok = await sendWhatsAppAlert('abc', MESSAGE);
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const phoneCalls = fetchMock.mock.calls.filter(([u]) => u.endsWith('/api/messages/send'));
    expect(phoneCalls).toHaveLength(2);
    const first = JSON.parse(phoneCalls[0]![1].body);
    expect(first.phone).toBe('573001112233');
    expect(first.message).toContain('https://google.com/travel');
    expect(first.message).not.toContain('tailnet.example');
  });

  it('returns false when the only attempt fails', async () => {
    delete process.env.WHATSAPP_ALERT_GROUP_ID;
    mockFindMany.mockResolvedValue([{ phone: '573001112233' }]);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' });
    expect(await sendWhatsAppAlert('abc', MESSAGE)).toBe(false);
  });
});
