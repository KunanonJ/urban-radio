"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

function isRemoteHttpUrl(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

type ArtworkImageProps = {
  src: string;
  alt: string;
  className?: string;
  /** Passed to `next/image` when using `fill` */
  sizes?: string;
  priority?: boolean;
};

/**
 * Remote HTTP(S) URLs use `next/image` (with `fill`); other sources use `<img>`.
 * Add `images.remotePatterns` in `next.config.ts` for new CDNs.
 */
export function ArtworkImage({ src, alt, className, sizes = "(max-width: 768px) 45vw, 200px", priority }: ArtworkImageProps) {
  if (!isRemoteHttpUrl(src)) {
    // Local/public paths or data URLs — skip optimizer until host is in `remotePatterns`.
    // eslint-disable-next-line @next/next/no-img-element -- intentional fallback
    return <img src={src} alt={alt} className={className} />;
  }
  return <Image src={src} alt={alt} fill sizes={sizes} className={cn(className)} priority={priority} />;
}
