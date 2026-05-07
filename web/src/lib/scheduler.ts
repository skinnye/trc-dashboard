/**
 * Cron scheduler: triggers snapshot at 17:00 MSK daily.
 * Registered once via instrumentation.ts on server startup.
 */
import cron from 'node-cron';
import { takeSnapshot } from './snapshot';
import { latestSnapshotDate, localDate } from './db';

let _started = false;

export function startScheduler() {
  if (_started) return;
  _started = true;

  // 17:00 Moscow time (server runs in Moscow TZ per Windows env)
  cron.schedule('0 17 * * *', async () => {
    console.log('[scheduler] Running 17:00 snapshot…');
    const r = await takeSnapshot();
    console.log(`[scheduler] Snapshot ${r.ok ? 'OK' : 'FAIL'} (${r.durationMs}ms, ${r.changesCount} changes)`, r.error ?? '');
  });

  // On boot: bootstrap if no snapshot ever, or catch up if we're past 17:00 today.
  void (async () => {
    const latest = latestSnapshotDate();
    const todaysDate = localDate();
    const pastFive = new Date().getHours() >= 17;
    if (!latest) {
      console.log('[scheduler] Boot: no snapshots exist, bootstrapping initial one…');
      const r = await takeSnapshot();
      console.log(`[scheduler] Bootstrap ${r.ok ? 'OK' : 'FAIL'}`, r.error ?? '');
    } else if (latest !== todaysDate && pastFive) {
      console.log('[scheduler] Boot: taking catch-up snapshot for today…');
      const r = await takeSnapshot();
      console.log(`[scheduler] Boot snapshot ${r.ok ? 'OK' : 'FAIL'}`, r.error ?? '');
    }
  })();

  console.log('[scheduler] Started — next run at 17:00 Moscow time.');
}
