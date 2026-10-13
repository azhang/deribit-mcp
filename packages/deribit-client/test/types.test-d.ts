// Compile-time checks only (`npm run typecheck`); never executed.
import { Deribit, type Result, type Params, type Method } from '../src/index.js';

declare const d: Deribit;

async function checks() {
  // Results are typed from the spec
  const ticker = await d.call('public/ticker', { instrument_name: 'BTC-PERPETUAL' });
  const mark: number | undefined = ticker.mark_price;

  const viaProxy = await d.public.get_index_price({ index_name: 'btc_usd' });
  const idx: number | undefined = viaProxy.index_price;

  // Methods without params need no argument
  await d.public.get_currencies();
  await d.call('public/get_time');

  // Enums are enforced
  await d.call('public/get_volatility_index_data', {
    currency: 'BTC', start_timestamp: 0, end_timestamp: 1, resolution: 3600,
  });

  // @ts-expect-error unknown method
  await d.call('public/does_not_exist', {});
  // @ts-expect-error missing required param
  await d.call('public/ticker', {});
  // @ts-expect-error wrong param type
  await d.call('public/ticker', { instrument_name: 42 });
  // @ts-expect-error unknown param
  await d.call('public/get_index_price', { index_name: 'btc_usd', include_old: true });

  const m: Method = 'private/get_positions';
  type P = Params<'private/get_positions'>;
  const p: P = { currency: 'BTC' };
  type R = Result<'public/get_funding_rate_history'>;
  const rows: R = [];
  return [mark, idx, m, p, rows];
}
void checks;
