import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import type { VideoThumbnail } from 'expo-video';
import { ThemedText } from '@/components/ThemedText';
import type { viewOrientations } from '@/store/settingsReducer';

type ThumbnailSource = VideoThumbnail | string;

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
  viewOrientation: viewOrientations;
  editMode: boolean;
  isRevealed: boolean;
  isEditable: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  onPressOut?: () => void;
};

export function PosterBox({
  item,
  cardWidth,
  thumbnailHeight,
  viewOrientation,
  editMode,
  isRevealed,
  isEditable,
  onPress,
  onLongPress,
  onPressOut,
}: PosterBoxProps) {
  const isFolder = item.kind === 'folder';
  const hasPoster = !!item.posterUri;

  // Items with a poster show the poster by default; long-press reveals the video thumbnail.
  const displaySource = item.posterUri && !isRevealed
    ? { uri: item.posterUri }
    : typeof item.thumbnailUri === 'string'
      ? { uri: item.thumbnailUri }
      : item.thumbnailUri; // VideoThumbnail (SharedRef) passed directly to expo-image

  // In poster layout, thumbnails are 16:9 and would be cropped by "cover"; use "contain" instead.
  const isShowingVideoThumbnail = !hasPoster || isRevealed;

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      onPressOut={onPressOut}
      style={[styles.card, { width: cardWidth }]}
    >
      <View style={[styles.thumbnailBox, { height: thumbnailHeight }]}>
        {displaySource ? (
          <Image
            source={displaySource}
            style={styles.thumbnailImage}
            contentFit={viewOrientation === 'poster' && isShowingVideoThumbnail ? 'contain' : 'cover'}
          />
        ) : (
          <View style={styles.thumbnailPlaceholder}>
            <ThemedText style={styles.placeholderIcon}>
              {isFolder ? '📁' : '🎬'}
            </ThemedText>
          </View>
        )}
        {/* Edit mode indicator overlay */}
        {editMode && isEditable && (
          <View style={styles.editOverlay}>
            <ThemedText style={styles.editOverlayIcon}>✏️</ThemedText>
          </View>
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
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
    padding: 3,
  },
  editOverlayIcon: {
    fontSize: 14,
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
