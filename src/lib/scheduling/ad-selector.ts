import type { Campaign } from '@/types/campaign';
import type { Spot } from '@/types/spot';
import {
  PRIORITY_WEIGHTS,
  type AdSelectorInput,
  type AdSelectorResult,
} from './types';

/**
 * Pure function: selects the best ad spot for an ad_break segment.
 *
 * Pipeline:
 * 1. Filter active campaigns by date, day-of-week, time window
 * 2. Filter by approved spots that match duration
 * 3. Apply advertiser separation
 * 4. Score: priority * (1 - played/contracted) -- prefer underfilled + high priority
 * 5. Select highest scoring
 */
export function selectAd(input: AdSelectorInput): AdSelectorResult {
  const { segment, campaigns, spots, context, history, currentHourItems } = input;

  // 1. Filter campaigns
  const activeCampaigns = campaigns.filter((c) => {
    if (c.status !== 'active') return false;
    if (c.startDate > context.date || c.endDate < context.date) return false;
    if (!c.allowedDays.includes(context.dayOfWeek)) return false;
    if (!isInTimeWindow(c, context.hour)) return false;
    return true;
  });

  // 2. For each campaign, find approved spots matching duration
  const candidatePairs: { campaign: Campaign; spot: Spot; score: number }[] = [];

  for (const campaign of activeCampaigns) {
    const campaignSpots = spots.get(campaign.id) ?? [];
    const approvedSpots = campaignSpots.filter((s) => s.approvalStatus === 'approved');
    const matchingSpots = approvedSpots.filter(
      (s) => s.durationSec === segment.targetDurationSec,
    );

    if (matchingSpots.length === 0) continue;

    // 3. Advertiser separation
    if (isAdvertiserTooClose(campaign.advertiserId, history, context.adRules.defaultMinMinutesBetweenSameAdvertiser)) {
      continue;
    }

    // Also check current hour items for same advertiser
    const hasAdInHour = currentHourItems.some(
      (item) => item.type === 'ad' && item.advertiserName === campaign.advertiserId,
    );
    if (hasAdInHour && context.adRules.defaultMinMinutesBetweenSameAdvertiser > 0) {
      // Skip if same advertiser already in this hour (conservative approach)
      continue;
    }

    // 4. Score
    const played = history.campaignPlayCounts.get(campaign.id) ?? 0;
    const fulfillmentRatio = campaign.contractedSpots > 0
      ? played / campaign.contractedSpots
      : 1;
    const needFactor = Math.max(0, 1 - fulfillmentRatio);
    const priorityWeight = PRIORITY_WEIGHTS[campaign.priority];
    const score = priorityWeight * (0.5 + needFactor); // base 0.5 so high-priority still wins even if near fulfilled

    // Pick a random spot from matching spots
    const spot = matchingSpots[Math.floor(Math.random() * matchingSpots.length)]!;
    candidatePairs.push({ campaign, spot, score });
  }

  if (candidatePairs.length === 0) {
    return { spot: null, campaign: null, conflicts: ['NO_VALID_AD'] };
  }

  // 5. Select highest scoring
  candidatePairs.sort((a, b) => b.score - a.score);
  const best = candidatePairs[0]!;

  return { spot: best.spot, campaign: best.campaign, conflicts: [] };
}

function isInTimeWindow(campaign: Campaign, hour: number): boolean {
  if (!campaign.allowedStartTime && !campaign.allowedEndTime) return true;

  const startHour = campaign.allowedStartTime
    ? parseInt(campaign.allowedStartTime.split(':')[0]!, 10)
    : 0;
  const endHour = campaign.allowedEndTime
    ? parseInt(campaign.allowedEndTime.split(':')[0]!, 10)
    : 23;

  return hour >= startHour && hour <= endHour;
}

function isAdvertiserTooClose(
  advertiserId: string,
  history: AdSelectorInput['history'],
  minMinutes: number,
): boolean {
  const plays = history.advertiserPlays.get(advertiserId);
  if (!plays || plays.length === 0) return false;

  const now = Date.now();
  const minMs = minMinutes * 60 * 1000;

  return plays.some((play) => {
    const playTime = new Date(play).getTime();
    return now - playTime < minMs;
  });
}
