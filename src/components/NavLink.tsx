"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

export type NextNavLinkProps = Omit<React.ComponentPropsWithoutRef<typeof Link>, "href"> & {
  to: string;
  className?: string;
  activeClassName?: string;
  end?: boolean;
};

const NavLink = forwardRef<HTMLAnchorElement, NextNavLinkProps>(
  ({ className, activeClassName, end, to, ...props }, ref) => {
    const pathname = usePathname();
    const active = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);

    return <Link ref={ref} href={to} className={cn(className, active && activeClassName)} {...props} />;
  },
);

NavLink.displayName = "NavLink";

export { NavLink };
