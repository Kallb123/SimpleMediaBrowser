import { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import type { ImageLoadEventData } from 'expo-image';
import type { VideoThumbnail } from 'expo-video';
import { ThemedText } from '@/components/ThemedText';
import { ListenProgressBar } from '@/components/ui/ListenProgressBar';
import { WatchedBadge } from '@/components/ui/WatchedBadge';
import type { ToggleWatched } from '@/components/ui/WatchedBadge';
import type { IMediaAudiobook } from '@/store/libraryReducer';
import { aspectRatio, needsBackdrop } from '@/utils/posterFit';

type ThumbnailSource = VideoThumbnail | string;

/** Blur strength for the backdrop that fills the letterbox area behind non-portrait art. */
const BACKDROP_BLUR_RADIUS = 24;

/**
 * Aspect ratios learned from onLoad, by image URI. Survives cell recycling and remounts so a
 * poster seen once never needs to re-decide whether it wants a backdrop.
 */
const loadedAspectByUri = new Map<string, number>();

export type PosterBoxItem = {
  kind: 'folder' | 'file';
  key: string;
  label: string;
  thumbnailUri?: ThumbnailSource;
  posterUri?: string;
  count?: number;
  /** 1-based part number of an audiobook file; shown in place of the placeholder icon. */
  partNumber?: number;
};

export type PosterBoxProps = {
  item: PosterBoxItem;
  cardWidth: number;
  thumbnailHeight: number;
  editMode: boolean;
  isRevealed: boolean;
  isEditable: boolean;
  isSelected?: boolean;
  /** A file's watched key (its `parsedPath`); a folder passes `watchKeys` instead. */
  watchKey?: string;
  watchKeys?: () => readonly string[];
  /** An audiobook cell (a root book or one of its part rows) gets a listening progress bar. */
  audiobook?: IMediaAudiobook;
  /** For a part row: its `parsedPath`, so the bar shows that part only. Absent on a root book. */
  audiobookPartPath?: string;
  onToggleWatched?: ToggleWatched;
  onPress: () => void;
  onLongPress?: () => void;
  onPressOut?: () => void;
  onEditPress?: () => void;
};

export function PosterBox({
  item,
  cardWidth,
  thumbnailHeight,
  editMode,
  isRevealed,
  isEditable,
  isSelected,
  watchKey,
  watchKeys,
  audiobook,
  audiobookPartPath,
  onToggleWatched,
  onPress,
  onLongPress,
  onPressOut,
  onEditPress,
}: PosterBoxProps) {
  const isFolder = item.kind === 'folder';

  // Items with a poster show the poster by default; long-press reveals the video thumbnail.
  const displaySource = item.posterUri && !isRevealed
    ? { uri: item.posterUri }
    : typeof item.thumbnailUri === 'string'
      ? { uri: item.thumbnailUri }
      : item.thumbnailUri; // VideoThumbnail (SharedRef) passed directly to expo-image

  // FlashList reuses cell views; recyclingKey makes expo-image blank the view when the cell is
  // rebound instead of briefly showing the previous item's artwork.
  const isPosterShown = !!item.posterUri && !isRevealed;
  const recyclingKey = `${item.key}:${isPosterShown ? 'poster' : 'thumb'}`;
  const sourceUri = displaySource && 'uri' in displaySource ? displaySource.uri : undefined;

  // The blurred backdrop only shows in letterbox bars, and costs a second (blurred) decode per
  // cell, so skip it when the image already fills the poster-shaped box. VideoThumbnails carry
  // their size; URI images report theirs via onLoad (until then, assume posters fit and
  // thumbnails/stills do not, so non-poster art never shows bare bars).
  const [loaded, setLoaded] = useState<{ key: string; aspect: number } | null>(null);
  const knownAspect =
    typeof item.thumbnailUri === 'object' && displaySource === item.thumbnailUri
      ? aspectRatio(item.thumbnailUri.width, item.thumbnailUri.height)
      : (sourceUri !== undefined ? loadedAspectByUri.get(sourceUri) : undefined)
        ?? (loaded?.key === recyclingKey ? loaded.aspect : undefined);
  const showBackdrop = needsBackdrop(knownAspect, cardWidth / thumbnailHeight, isPosterShown);

  const handleImageLoad = (e: ImageLoadEventData) => {
    const aspect = aspectRatio(e.source.width, e.source.height);
    if (aspect === undefined) return;
    if (sourceUri !== undefined) loadedAspectByUri.set(sourceUri, aspect);
    setLoaded({ key: recyclingKey, aspect });
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      onPressOut={onPressOut}
      style={[styles.card, { width: cardWidth }]}
    >
      <View style={[
        styles.thumbnailBox,
        { height: thumbnailHeight },
        isSelected && styles.thumbnailBoxSelected,
      ]}>
        {displaySource ? (
          <>
            {/* Blurred, cover-scaled copy of the same art fills the letterbox area so
                non-portrait images (landscape stills, square audiobook covers) sit in a
                uniform poster-shaped box without cropping or flat empty bars. Poster-shaped
                images cover the box exactly, so the backdrop isn't rendered for them. */}
            {showBackdrop && (
              <Image
                source={displaySource}
                style={styles.thumbnailBackdrop}
                contentFit="cover"
                blurRadius={BACKDROP_BLUR_RADIUS}
                recyclingKey={recyclingKey}
              />
            )}
            <Image
              source={displaySource}
              style={styles.thumbnailImage}
              contentFit="contain"
              recyclingKey={recyclingKey}
              onLoad={knownAspect === undefined ? handleImageLoad : undefined}
            />
          </>
        ) : (
          <View style={styles.thumbnailPlaceholder}>
            {/* Folder icon; audiobook parts show their part number; other files the movie icon. */}
            {!isFolder && item.partNumber !== undefined ? (
              <ThemedText
                style={styles.placeholderPartNumber}
                accessibilityLabel={`Part ${item.partNumber}`}
              >
                {item.partNumber}
              </ThemedText>
            ) : (
              <ThemedText style={styles.placeholderIcon}>
                {isFolder ? '📁' : '🎬'}
              </ThemedText>
            )}
          </View>
        )}
        {/* Selection indicator overlay – shown in edit mode when the item is selected */}
        {isSelected && (
          <View style={styles.selectedOverlay}>
            <View style={styles.selectedCheckCircle}>
              <ThemedText style={styles.selectedCheckIcon}>✓</ThemedText>
            </View>
          </View>
        )}
        {/* Edit mode badge – prominent button to open the edit screen */}
        {editMode && isEditable && !isSelected && (
          <TouchableOpacity style={styles.editOverlay} onPress={onEditPress} activeOpacity={0.7}>
            <ThemedText style={styles.editOverlayIcon}>✏️</ThemedText>
          </TouchableOpacity>
        )}
        {/* Watched tick (and, in edit mode, the manual watched toggle) */}
        <WatchedBadge
          variant="poster"
          watchKey={watchKey}
          watchKeys={watchKeys}
          editable={editMode}
          onToggle={onToggleWatched}
        />
        {audiobook && <ListenProgressBar audiobook={audiobook} partPath={audiobookPartPath} />}
        {/* Entry count badge for show/season folders */}
        {item.kind === 'folder' && item.count !== undefined && (
          <View
            style={styles.countBadge}
            accessibilityLabel={`${item.count} ${item.count === 1 ? 'episode' : 'episodes'}`}
          >
            <ThemedText style={styles.countBadgeText}>{item.count}</ThemedText>
          </View>
        )}
      </View>
      <ThemedText style={styles.cardLabel} numberOfLines={2}>
        {item.label}
      </ThemedText>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  thumbnailBox: {
    width: '100%',
    backgroundColor: '#222',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  thumbnailBoxSelected: {
    borderWidth: 3,
    borderColor: '#0a7ea4',
  },
  thumbnailBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderIcon: {
    fontSize: 32,
  },
  placeholderPartNumber: {
    fontSize: 36,
    lineHeight: 44,
    fontWeight: '700',
  },
  cardLabel: {
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 6,
    fontSize: 12,
  },
  editOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(10,126,164,0.85)',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  editOverlayIcon: {
    fontSize: 18,
  },
  selectedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10,126,164,0.25)',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    padding: 6,
  },
  selectedCheckCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#0a7ea4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedCheckIcon: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  countBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
});
