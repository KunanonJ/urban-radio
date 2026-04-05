import { describe, it, expect } from 'vitest';
import { selectAd } from './ad-selector';
import type { Campaign } from '@/types/campaign';
import type { Spot } from '@/types/spot';
import type { ClockSegment } from '@/types/clock-template';
import type { SchedulingContext, PlayHistory } from './types';

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-1',
    advertiserId: 'adv-1',
    campaignName: 'Test Campaign',
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    contractedSpots: 100,
    priority: 'normal',
    allowedDays: [0, 1, 2, 3, 4, 5, 6],
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSpot(overrides: Partial<Spot> = {}): Spot {
  return {
    id: 'spot-1',
    campaignId: 'camp-1',
    title: 'Test Spot 30s',
    durationSec: 30,
    audioStoragePath: '/audio/spot.mp3',
    contentHash: 'def456',
    approvalStatus: 'approved',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeAdSegment(overrides: Partial<ClockSegment> = {}): ClockSegment {
  return {
    id: 'seg-ad-1',
    type: 'ad_break',
    label: 'Ad Break',
    targetDurationSec: 30,
    slotCount: 1,
    position: 0,
    ...overrides,
  };
}

const defaultContext: SchedulingContext = {
  date: '2026-04-05',
  hour: 10,
  dayOfWeek: 0,
  explicitAllowed: true,
  songRules: { sameArtistMinSlots: 4, sameTrackMinHours: 2 },
  adRules: { defaultMinMinutesBetweenSameAdvertiser: 30 },
};

const emptyHistory: PlayHistory = {
  trackPlays: new Map(),
  artistPlays: new Map(),
  advertiserPlays: new Map(),
  campaignPlayCounts: new Map(),
};

describe('selectAd', () => {
  it('selects a spot when valid options exist', () => {
    const campaigns = [makeCampaign()];
    const spots = new Map([['camp-1', [makeSpot()]]]);
    const result = selectAd({
      segment: makeAdSegment(),
      campaigns,
      spots,
      context: defaultContext,
      history: emptyHistory,
      currentHourItems: [],
    });
    expect(result.spot).not.toBeNull();
    expect(result.spot?.id).toBe('spot-1');
    expect(result.campaign?.id).toBe('camp-1');
    expect(result.conflicts).toHaveLength(0);
  });

  it('returns NO_VALID_AD when no campaigns', () => {
    const result = selectAd({
      segment: makeAdSegment(),
      campaigns: [],
      spots: new Map(),
      context: defaultContext,
      history: emptyHistory,
      currentHourItems: [],
    });
    expect(result.spot).toBeNull();
    expect(result.conflicts).toContain('NO_VALID_AD');
  });

  it('filters campaigns outside date range', () => {
    const campaigns = [makeCampaign({ startDate: '2026-05-01', endDate: '2026-05-31' })];
    const spots = new Map([['camp-1', [makeSpot()]]]);
    const result = selectAd({
      segment: makeAdSegment(),
      campaigns,
      spots,
      context: defaultContext,
      history: emptyHistory,
      currentHourItems: [],
    });
    expect(result.spot).toBeNull();
  });

  it('filters campaigns not allowed on current day', () => {
    // Day 0 = Sunday, campaign only allows weekdays
    const campaigns = [makeCampaign({ allowedDays: [1, 2, 3, 4, 5] })];
    const spots = new Map([['camp-1', [makeSpot()]]]);
    const result = selectAd({
      segment: makeAdSegment(),
      campaigns,
      spots,
      context: { ...defaultContext, dayOfWeek: 0 },
      history: emptyHistory,
      currentHourItems: [],
    });
    expect(result.spot).toBeNull();
  });

  it('filters non-active campaigns', () => {
    const campaigns = [makeCampaign({ status: 'paused' })];
    const spots = new Map([['camp-1', [makeSpot()]]]);
    const result = selectAd({
      segment: makeAdSegment(),
      campaigns,
      spots,
      context: defaultContext,
      history: emptyHistory,
      currentHourItems: [],
    });
    expect(result.spot).toBeNull();
  });

  it('filters unapproved spots', () => {
    const campaigns = [makeCampaign()];
    const spots = new Map([['camp-1', [makeSpot({ approvalStatus: 'pending' })]]]);
    const result = selectAd({
      segment: makeAdSegment(),
      campaigns,
      spots,
      context: defaultContext,
      history: emptyHistory,
      currentHourItems: [],
    });
    expect(result.spot).toBeNull();
  });

  it('prefers underfilled campaigns', () => {
    const camp1 = makeCampaign({ id: 'camp-1', advertiserId: 'adv-1', contractedSpots: 100 });
    const camp2 = makeCampaign({ id: 'camp-2', advertiserId: 'adv-2', contractedSpots: 100 });
    const spots = new Map([
      ['camp-1', [makeSpot({ id: 'spot-1', campaignId: 'camp-1' })]],
      ['camp-2', [makeSpot({ id: 'spot-2', campaignId: 'camp-2' })]],
    ]);
    // camp-1 has 90 plays (90%), camp-2 has 10 plays (10%) -> camp-2 more underfilled
    const history: PlayHistory = {
      ...emptyHistory,
      campaignPlayCounts: new Map([['camp-1', 90], ['camp-2', 10]]),
    };
    const result = selectAd({
      segment: makeAdSegment(),
      campaigns: [camp1, camp2],
      spots,
      context: defaultContext,
      history,
      currentHourItems: [],
    });
    expect(result.campaign?.id).toBe('camp-2');
  });

  it('prefers higher priority campaigns', () => {
    const campHigh = makeCampaign({ id: 'camp-high', advertiserId: 'adv-1', priority: 'high' });
    const campLow = makeCampaign({ id: 'camp-low', advertiserId: 'adv-2', priority: 'low' });
    const spots = new Map([
      ['camp-high', [makeSpot({ id: 'spot-h', campaignId: 'camp-high' })]],
      ['camp-low', [makeSpot({ id: 'spot-l', campaignId: 'camp-low' })]],
    ]);
    const result = selectAd({
      segment: makeAdSegment(),
      campaigns: [campHigh, campLow],
      spots,
      context: defaultContext,
      history: emptyHistory,
      currentHourItems: [],
    });
    expect(result.campaign?.id).toBe('camp-high');
  });

  it('matches spot duration to segment target', () => {
    const campaigns = [makeCampaign()];
    const spots = new Map([
      ['camp-1', [
        makeSpot({ id: 'spot-15', durationSec: 15 }),
        makeSpot({ id: 'spot-30', durationSec: 30 }),
      ]],
    ]);
    const result = selectAd({
      segment: makeAdSegment({ targetDurationSec: 30 }),
      campaigns,
      spots,
      context: defaultContext,
      history: emptyHistory,
      currentHourItems: [],
    });
    expect(result.spot?.id).toBe('spot-30');
  });

  it('filters campaigns outside time window', () => {
    const campaigns = [makeCampaign({ allowedStartTime: '14:00', allowedEndTime: '18:00' })];
    const spots = new Map([['camp-1', [makeSpot()]]]);
    // Current hour is 10, campaign allows 14-18
    const result = selectAd({
      segment: makeAdSegment(),
      campaigns,
      spots,
      context: { ...defaultContext, hour: 10 },
      history: emptyHistory,
      currentHourItems: [],
    });
    expect(result.spot).toBeNull();
  });

  it('respects advertiser separation', () => {
    const camp1 = makeCampaign({ id: 'camp-1', advertiserId: 'adv-1' });
    const camp2 = makeCampaign({ id: 'camp-2', advertiserId: 'adv-2' });
    const spots = new Map([
      ['camp-1', [makeSpot({ id: 'spot-1', campaignId: 'camp-1' })]],
      ['camp-2', [makeSpot({ id: 'spot-2', campaignId: 'camp-2' })]],
    ]);
    // adv-1 played 10 min ago (within 30 min separation)
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const history: PlayHistory = {
      ...emptyHistory,
      advertiserPlays: new Map([['adv-1', [tenMinAgo]]]),
      campaignPlayCounts: new Map(),
    };
    const result = selectAd({
      segment: makeAdSegment(),
      campaigns: [camp1, camp2],
      spots,
      context: defaultContext,
      history,
      currentHourItems: [],
    });
    expect(result.campaign?.advertiserId).toBe('adv-2');
  });
});
