import { memo, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { ProgressStrip } from '@/components/ui/ProgressStrip';
import { selectWatchProgress } from '@/store/libraryReducer';
import { selectVideoShowProgressBar } from '@/store/settingsReducer';
import type { RootState } from '@/store/store';
import { latestWatchProgressFraction, watchProgressFraction } from '@/scripts/videoProgress';

export type WatchProgressBarProps = {
  /** The file this bar is for (its `parsedPath`). Set this or `watchKeys`. */
  watchKey?: string;
  /**
   * For a folder (show / season): lazily lists the files below it; the bar shows the episode in
   * progress. Keep the function's identity stable, as for `WatchedBadge`.
   */
  watchKeys?: () => readonly string[];
};

/**
 * Thin bar along the bottom of a video cell or row showing how far in-app playback has got, the
 * way `ListenProgressBar` does for audiobooks. A season / show folder shows the most recently
 * played episode that is part-way through. Renders nothing without resumable progress, or when
 * the "show progress bar" setting is off.
 *
 * A file subscribes to just its own entry, so the 10 s progress saves re-render only that bar.
 */
export const WatchProgressBar = memo(function WatchProgressBar({ watchKey, watchKeys }: WatchProgressBarProps) {
  const enabled = useSelector(selectVideoShowProgressBar);
  const fileProgress = useSelector((state: RootState) =>
    watchKey !== undefined ? selectWatchProgress(state)[watchKey] : undefined,
  );
  // Folders watch the whole map; files skip it so their bar only follows its own entry.
  const allProgress = useSelector((state: RootState) =>
    watchKey === undefined && watchKeys ? selectWatchProgress(state) : undefined,
  );
  const keys = useMemo(
    () => (watchKey === undefined && watchKeys ? watchKeys() : []),
    [watchKey, watchKeys],
  );
  const fraction = watchKey !== undefined
    ? watchProgressFraction(fileProgress)
    : allProgress ? latestWatchProgressFraction(allProgress, keys) : 0;

  if (!enabled || !fraction) return null;

  return <ProgressStrip fraction={fraction} accessibilityLabel="Watching progress" />;
});
