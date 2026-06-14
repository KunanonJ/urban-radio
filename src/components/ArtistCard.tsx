"use client";

import Link from 'next/link';
import { Artist } from '@/lib/types';
import { motion } from 'framer-motion';
import { ArtworkImage } from '@/components/ArtworkImage';

export function ArtistCard({ artist, index = 0 }: { artist: Artist; index?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
      <Link href={`/app/artist/${artist.id}`} className="group block text-center">
        <div className="relative mx-auto w-full aspect-square rounded-full overflow-hidden mb-3">
          <ArtworkImage
            src={artist.artwork}
            alt={artist.name}
            className="object-cover transition-transform duration-300 group-hover:scale-110"
          />
        </div>
        <h3 className="text-sm font-medium text-foreground truncate">{artist.name}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{artist.genres[0]}</p>
      </Link>
    </motion.div>
  );
}
