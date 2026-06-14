"use client";

import Link from 'next/link';
import { Play } from 'lucide-react';
import { Playlist } from '@/lib/types';
import { usePlayerStore } from '@/lib/store';
import { motion } from 'framer-motion';
import { ArtworkImage } from '@/components/ArtworkImage';

export function PlaylistCard({ playlist, index = 0 }: { playlist: Playlist; index?: number }) {
  const { setQueue } = usePlayerStore();
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
      <Link href={`/app/playlist/${playlist.id}`} className="group block">
        <div className="relative overflow-hidden rounded-lg mb-3 aspect-square">
          <ArtworkImage
            src={playlist.artwork}
            alt={playlist.title}
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
          <button
            onClick={(e) => { e.preventDefault(); setQueue(playlist.tracks); }}
            className="absolute bottom-3 right-3 w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all shadow-lg glow-sm"
          >
            <Play className="w-4 h-4 ml-0.5" />
          </button>
        </div>
        <h3 className="text-sm font-medium text-foreground truncate">{playlist.title}</h3>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{playlist.trackCount} tracks</p>
      </Link>
    </motion.div>
  );
}
