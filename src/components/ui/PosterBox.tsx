import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import type { VideoThumbnail } from 'expo-video';
import { ThemedText } from '@/components/ThemedText';

type ThumbnailSource = VideoThumbnail | string;

/** Blur strength for the backdrop that fills the letterbox area behind non-portrait art. */
const BACKDROP_BLUR_RADIUS = 24;

export type PosterBoxItem = {
  kind: 'folder' | 'file';
  key: string;
  label: string;
  thumbnailUri?: ThumbnailSource;
  posterUri?: string;
  count?: number;
};

export type PosterBoxProps = {
  item: PosterBoxItem;
  cardWidth: number;
  thumbnailHeight: number;
  editMode: boolean;
  isRevealed: boolean;
  isEditable: boolean;
  isSelected?: boolean;
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
                uniform poster-shaped box without cropping or flat empty bars. Portrait
                posters cover the box exactly, hiding the backdrop entirely. */}
            <Image
              source={displaySource}
              style={styles.thumbnailBackdrop}
              contentFit="cover"
              blurRadius={BACKDROP_BLUR_RADIUS}
            />
            <Image
              source={displaySource}
              style={styles.thumbnailImage}
              contentFit="contain"
            />
          </>
        ) : (
          <View style={styles.thumbnailPlaceholder}>
            <ThemedText style={styles.placeholderIcon}>
              {isFolder ? '📁' : '🎬'}
            </ThemedText>
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
