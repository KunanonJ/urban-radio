"use client";

import { useTranslation } from "react-i18next";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SidebarNav } from "@/components/SidebarNav";
import { Music2 } from "lucide-react";

type MobileNavSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function MobileNavSheet({ open, onOpenChange }: MobileNavSheetProps) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-[min(100vw-1rem,20rem)] p-0 flex flex-col gap-0 overflow-y-auto"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{t("layout.menuTitle")}</SheetTitle>
        </SheetHeader>
        <div className="h-14 flex items-center border-b border-border shrink-0 px-4 gap-2.5 pr-12">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <Music2 className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-bold text-base tracking-tight text-foreground truncate">
            {t("layout.appName")}
          </span>
        </div>
        <SidebarNav iconOnly={false} onNavigate={() => onOpenChange(false)} className="pb-6" />
      </SheetContent>
    </Sheet>
  );
}
