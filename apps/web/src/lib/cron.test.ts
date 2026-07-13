import { describe, it, expect, vi, afterEach } from 'vitest';

const { mockFindFirst, mockRunScrapeAll, mockCleanup, mockExpire, mockNotify } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockRunScrapeAll: vi.fn(),
  mockCleanup: vi.fn(),
  mockExpire: vi.fn(),
  mockNotify: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    extractionConfig: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
  },
}));

vi.mock('./scraper/run-scrape', () => ({
  runScrapeAll: (...args: unknown[]) => mockRunScrapeAll(...args),
  cleanupUnvisitedQueries: (...args: unknown[]) => mockCleanup(...args),
}));

vi.mock('./scraper/expire-queries', () => ({
  expireDepartedQueries: (...args: unknown[]) => mockExpire(...args),
}));

vi.mock('./notifications/run', () => ({
  notifyNewLows: (...args: unknown[]) => mockNotify(...args),
}));

import { startCron, stopCron, getCronInfo, updateCronInterval } from './cron';

afterEach(() => {
  stopCron();
  vi.useRealTimers();
  mockFindFirst.mockReset();
  mockRunScrapeAll.mockReset();
  mockCleanup.mockReset();
  mockExpire.mockReset();
  mockNotify.mockReset();
  delete process.env.CRON_INTERVAL_HOURS;
  delete process.env.CRON_ENABLED;
});

describe('cron scheduler reads DB interval', () => {
  it('uses database scrapeInterval on startup instead of env var default', async () => {
    mockFindFirst.mockImplementation(() => Promise.resolve({ id: 'singleton', scrapeInterval: 1 }));

    await startCron();
    const info = getCronInfo();

    expect(info.intervalHours).toBe(1);
    expect(mockFindFirst).toHaveBeenCalledWith({ where: { id: 'singleton' } });
  });

  it('falls back to env var when DB has no config row', async () => {
    process.env.CRON_INTERVAL_HOURS = '6';
    mockFindFirst.mockImplementation(() => Promise.resolve(null));

    await startCron();

    expect(getCronInfo().intervalHours).toBe(6);
  });

  it('falls back to env var when DB query fails', async () => {
    process.env.CRON_INTERVAL_HOURS = '4';
    mockFindFirst.mockImplementation(() => Promise.reject(new Error('connection refused')));

    await startCron();

    expect(getCronInfo().intervalHours).toBe(4);
  });

  it('defaults to 3h when no DB config and no env var', async () => {
    mockFindFirst.mockImplementation(() => Promise.resolve(null));

    await startCron();

    expect(getCronInfo().intervalHours).toBe(3);
  });
});

describe('updateCronInterval', () => {
  it('immediately reschedules with new interval', async () => {
    vi.useFakeTimers();
    mockFindFirst.mockImplementation(() => Promise.resolve({ id: 'singleton', scrapeInterval: 3 }));
    await startCron();
    expect(getCronInfo().intervalHours).toBe(3);

    updateCronInterval(1);

    expect(getCronInfo().intervalHours).toBe(1);
    // Next scrape should be ~1h from now, not ~3h
    const next = new Date(getCronInfo().nextScrape!).getTime();
    const now = Date.now();
    const hoursUntilNext = (next - now) / (1000 * 60 * 60);
    expect(hoursUntilNext).toBeGreaterThan(0.9);
    expect(hoursUntilNext).toBeLessThan(1.1);
  });

  it('clamps interval to 1-24 range', async () => {
    vi.useFakeTimers();
    mockFindFirst.mockImplementation(() => Promise.resolve(null));
    await startCron();

    updateCronInterval(0);
    expect(getCronInfo().intervalHours).toBe(1);

    updateCronInterval(48);
    expect(getCronInfo().intervalHours).toBe(24);
  });
});

describe('cron fires new-low notifications', () => {
  it('calls notifyNewLows with the successful query ids after a scheduled scrape', async () => {
    vi.useFakeTimers();
    mockFindFirst.mockResolvedValue({ id: 'singleton', scrapeInterval: 1 });
    mockCleanup.mockResolvedValue(0);
    mockExpire.mockResolvedValue(0);
    mockRunScrapeAll.mockResolvedValue([
      { queryId: 'q1', status: 'success', snapshotsCount: 7 },
      { queryId: 'q2', status: 'failed', snapshotsCount: 0 },
    ]);
    mockNotify.mockResolvedValue(undefined);

    await startCron();
    await vi.advanceTimersByTimeAsync(3600 * 1000 + 151 * 1000);

    expect(mockRunScrapeAll).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(['q1'], expect.any(Date));
  });

  it('captures the cycle boundary before scraping so fresh snapshots count as current', async () => {
    vi.useFakeTimers();
    mockFindFirst.mockResolvedValue({ id: 'singleton', scrapeInterval: 1 });
    mockCleanup.mockResolvedValue(0);
    mockExpire.mockResolvedValue(0);
    mockRunScrapeAll.mockResolvedValue([{ queryId: 'q1', status: 'success', snapshotsCount: 1 }]);
    mockNotify.mockResolvedValue(undefined);

    const before = new Date();
    await startCron();
    await vi.advanceTimersByTimeAsync(3600 * 1000 + 151 * 1000);

    const passed = mockNotify.mock.calls[0][1] as Date;
    expect(passed.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('does not throw the cron run when notifyNewLows rejects', async () => {
    vi.useFakeTimers();
    mockFindFirst.mockResolvedValue({ id: 'singleton', scrapeInterval: 1 });
    mockCleanup.mockResolvedValue(0);
    mockExpire.mockResolvedValue(0);
    mockRunScrapeAll.mockResolvedValue([{ queryId: 'q1', status: 'success', snapshotsCount: 1 }]);
    mockNotify.mockRejectedValue(new Error('whatsapp down'));

    await startCron();
    await vi.advanceTimersByTimeAsync(3600 * 1000 + 151 * 1000);

    expect(getCronInfo().nextScrape).not.toBeNull();
  });
});

describe('CRON_ENABLED', () => {
  it('does not start when CRON_ENABLED=false', async () => {
    process.env.CRON_ENABLED = 'false';
    mockFindFirst.mockImplementation(() => Promise.resolve({ id: 'singleton', scrapeInterval: 1 }));

    await startCron();

    expect(getCronInfo().nextScrape).toBeNull();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});
