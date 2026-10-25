import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSelector } from 'react-redux';
import { selectListenProgress } from '@/store/libraryReducer';
import type { IMediaAudiobook } from '@/store/libraryReducer';
import type { RootState } from '@/store/store';
import { audiobookProgressFraction, partProgressFraction } from '@/scripts/audiobookProgress';

export type ListenProgressBarProps = {
  audiobook: IMediaAudiobook;
  /** A part row's `parsedPath`: show that part's progress (only while it is the saved part). Omit for the whole book. */
  partPath?: string;
};

/**
 * Thin bar along the bottom of an audiobook cell or row showing how far in-app listening has got:
 * the whole book for a root entry, or the saved part's own progress on a part row. Renders nothing
 * without progress.
 *
 * Like `WatchedBadge` it subscribes to the progress itself (just this book's entry), so the 10 s
 * progress saves re-render only these bars, not the cells or the list around them.
 */
export const ListenProgressBar = memo(function ListenProgressBar({ audiobook, partPath }: ListenProgressBarProps) {
  const progress = useSelector((state: RootState) => selectListenProgress(state)[audiobook.folderKey]);
  const fraction = partPath !== undefined
    ? partProgressFraction(progress, partPath)
    : audiobookProgressFraction(audiobook, progress);

  if (!fraction) return null;

  return (
    <View
      style={styles.track}
      pointerEvents="none"
      accessibilityRole="progressbar"
      accessibilityLabel="Listening progress"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
    >
      <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
    </View>
  );
});

const styles = StyleSheet.create({
  // Overlays the bottom edge of the cell (the poster box clips it to its rounded corners).
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  fill: {
    height: '100%',
    backgroundColor: '#0a7ea4',
  },
});
