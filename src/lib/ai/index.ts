/**
 * AI capabilities — public barrel.
 *
 * Consumers import from `@/lib/ai`. Each capability re-exports its own interface, stub
 * implementation, factory, and SWAP POINT comment pointing at where real providers plug in.
 */

export * from './types';
export * from './voice';
export * from './text';
export * from './transcribe';
export * from './anr';
export * from './cost-guard';
