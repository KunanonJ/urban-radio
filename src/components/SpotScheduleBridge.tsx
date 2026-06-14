import { useEffect } from 'react';
import { toast } from 'sonner';
import i18n from '@/i18n';
import { evaluateSpotRulesTick } from '@/lib/spot-schedule-store';

/** Evaluates spot rules every second (local clock). */
export function SpotScheduleBridge() {
  useEffect(() => {
    const id = window.setInterval(() => {
      const fired = evaluateSpotRulesTick(new Date());
      for (const ev of fired) {
        toast.success(
          i18n.t('spotSchedule.toastFired', { name: ev.ruleName, title: ev.trackTitle })
        );
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return null;
}
