import { redirect } from 'next/navigation';
import { formatDateKey } from '@/lib/utils/format';

export default function RundownPage() {
  const today = formatDateKey(new Date());
  redirect(`/app/rundown/${today}`);
}
