import { memo, useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSelector } from 'react-redux';
import { ThemedText } from '@/components/ThemedText';
import { areAllWatched, selectWatched } from '@/store/libraryReducer';

/** Called with the file keys the badge stands for and whether they should now be watched. */
export type ToggleWatched = (keys: readonly string[], watched: boolean) => void;

export type WatchedBadgeProps = {
  /** The file this badge is for (its `parsedPath`). Set this or `watchKeys`. */
  watchKey?: string;
  /**
   * For a folder (show / season / multi-part audiobook): lazily lists the files below it.
   * Keep the function's identity stable (the display-item builder owns it) so the keys are
   * only resolved once per list build.
   */
  watchKeys?: () => readonly string[];
  /** Edit mode: always show a tappable toggle, ticked or not. Otherwise only a ticked, inert badge. */
  editable: boolean;
  onToggle?: ToggleWatched;
  /** `poster` floats over a grid cell's bottom-left corner; `list` sits inline in a row. */
  variant: 'poster' | 'list';
};

/**
 * Tick for a watched file, or for a folder whose files are all watched. In edit mode it is
 * also the manual set/unset control (a folder toggles every file below it at once).
 *
 * Each badge subscribes to the watched map itself, so marking a file re-renders only these
 * small badges, never the cells (and their images) or the list around them.
 */
export const WatchedBadge = memo(function WatchedBadge({ watchKey, watchKeys, editable, onToggle, variant }: WatchedBadgeProps) {
  const watched = useSelector(selectWatched);
  const keys = useMemo(
    () => (watchKey !== undefined ? [watchKey] : watchKeys?.() ?? []),
    [watchKey, watchKeys],
  );
  const isWatched = areAllWatched(watched, keys);

  if (!isWatched && !(editable && keys.length > 0)) return null;

  const containerStyle = [
    styles.circle,
    variant === 'poster' ? styles.posterPosition : styles.listPosition,
    isWatched ? styles.circleWatched : styles.circleUnwatched,
  ];
  const tick = isWatched ? <ThemedText style={styles.tick}>✓</ThemedText> : null;

  if (editable && onToggle) {
    return (
      <TouchableOpacity
        style={containerStyle}
        onPress={() => onToggle(keys, !isWatched)}
        hitSlop={8}
        activeOpacity={0.7}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isWatched }}
        accessibilityLabel={isWatched ? 'Watched. Tap to mark as unwatched' : 'Not watched. Tap to mark as watched'}
      >
        {tick}
      </TouchableOpacity>
    );
  }

  return (
    <View style={containerStyle} pointerEvents="none" accessibilityLabel="Watched">
      {tick}
    </View>
  );
});

const styles = StyleSheet.create({
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  // Bottom-left is free: the selection check is top-left, the edit pencil top-right, the
  // folder count bottom-right, and an audiobook part number is centred.
  posterPosition: {
    position: 'absolute',
    bottom: 4,
    left: 4,
  },
  listPosition: {},
  circleWatched: {
    backgroundColor: '#2e9e5b',
  },
  circleUnwatched: {
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  tick: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '700',
  },
});
