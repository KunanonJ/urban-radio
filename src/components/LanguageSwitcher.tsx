import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Props = {
  /** Show compact icon-only on narrow layouts */
  compact?: boolean;
};

export function LanguageSwitcher({ compact }: Props) {
  const { i18n, t } = useTranslation();
  const code = i18n.language?.startsWith('th') ? 'th' : 'en';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground hover:text-foreground"
          aria-label={t('language.switcherAria')}
        >
          <Languages className="w-4 h-4 shrink-0" />
          {!compact && (
            <span className="text-xs font-medium">{t(`language.names.${code}`)}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        <DropdownMenuItem onClick={() => void i18n.changeLanguage('th')}>
          {t('language.names.th')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void i18n.changeLanguage('en')}>
          {t('language.names.en')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
