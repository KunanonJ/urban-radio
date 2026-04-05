'use client';

import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { getClientAuth } from '@/lib/firebase/client';
import { useAuth } from '@/lib/auth/context';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';

export function UserMenu() {
  const { profile, role } = useAuth();
  const router = useRouter();

  async function handleSignOut() {
    await signOut(getClientAuth());
    router.replace('/login');
  }

  const initials = profile?.displayName
    ? profile.displayName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '??';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium"
      >
        {initials}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">
              {profile?.displayName ?? 'Unknown'}
            </p>
            <p className="text-xs leading-none text-muted-foreground">
              {profile?.email}
            </p>
            {role && (
              <Badge variant="secondary" className="mt-1 w-fit text-xs">
                {role}
              </Badge>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
