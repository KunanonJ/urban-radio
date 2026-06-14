"use client";

import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Disc3, ListPlus, MoreHorizontal, Play, StepForward, UserRound } from "lucide-react";
import type { Track } from "@/lib/types";
import { usePlayerStore } from "@/lib/store";
import { useCatalogArtists } from "@/lib/catalog-queries";
import { useMergedAlbums } from "@/lib/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type TrackActionsMenuProps = {
  track: Track;
  queuePosition?: number;
};

export function TrackActionsMenu({ track, queuePosition }: TrackActionsMenuProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const albums = useMergedAlbums();
  const { data: apiArtists } = useCatalogArtists();
  const artists = useMemo(() => apiArtists ?? [], [apiArtists]);
  const hasArtists = artists.length > 0;
  const play = usePlayerStore((state) => state.play);
  const playAtQueueIndex = usePlayerStore((state) => state.playAtQueueIndex);
  const playNext = usePlayerStore((state) => state.playNext);
  const addToQueue = usePlayerStore((state) => state.addToQueue);

  const albumRoute = useMemo(
    () =>
      albums.find(
        (album) =>
          album.id === track.albumId &&
          album.title === track.album &&
          album.artistId === track.artistId,
      ) ?? null,
    [albums, track.album, track.albumId, track.artistId],
  );
  const artistRoute = useMemo(
    () =>
      artists.find((artist) => artist.id === track.artistId && artist.name === track.artist) ?? null,
    [artists, track.artist, track.artistId],
  );

  const albumHref = albumRoute ? `/app/album/${albumRoute.id}` : null;
  const artistHref = artistRoute ? `/app/artist/${artistRoute.id}` : null;
  const showAlbumLink = albumHref != null && pathname !== albumHref;
  const showArtistLink = artistHref != null && pathname !== artistHref;
  const playCurrentRow = () => {
    if (queuePosition != null) {
      playAtQueueIndex(queuePosition);
      return;
    }
    play(track);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="track-actions-trigger"
          className="rounded p-1 text-muted-foreground transition-all opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:text-foreground md:opacity-0 md:group-hover:opacity-100 data-[state=open]:opacity-100"
          aria-label={t("trackActions.openMenu", { title: track.title })}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem data-testid="track-action-play-now" className="gap-2" onSelect={playCurrentRow}>
          <Play className="h-4 w-4" />
          {t("trackActions.playNow")}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="track-action-play-next"
          className="gap-2"
          onSelect={() => {
            playNext(track);
            toast.success(t("trackActions.willPlayNext", { title: track.title }));
          }}
        >
          <StepForward className="h-4 w-4" />
          {t("trackActions.playNext")}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="track-action-add-to-queue"
          className="gap-2"
          onSelect={() => {
            addToQueue(track);
            toast.success(t("trackActions.queuedTrack", { title: track.title }));
          }}
        >
          <ListPlus className="h-4 w-4" />
          {t("tracks.addToQueue")}
        </DropdownMenuItem>
        {(showAlbumLink || showArtistLink || !hasArtists) && <DropdownMenuSeparator />}
        {showAlbumLink && (
          <DropdownMenuItem
            data-testid="track-action-go-to-album"
            className="gap-2"
            onSelect={() => router.push(albumHref)}
          >
            <Disc3 className="h-4 w-4" />
            {t("trackActions.goToAlbum")}
          </DropdownMenuItem>
        )}
        {hasArtists ? (
          showArtistLink && (
            <DropdownMenuItem
              data-testid="track-action-go-to-artist"
              className="gap-2"
              onSelect={() => router.push(artistHref)}
            >
              <UserRound className="h-4 w-4" />
              {t("trackActions.goToArtist")}
            </DropdownMenuItem>
          )
        ) : (
          <DropdownMenuItem
            data-testid="track-action-no-artists"
            className="gap-2"
            disabled
          >
            <UserRound className="h-4 w-4" />
            {t("emptyStates.trackArtists.title")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
