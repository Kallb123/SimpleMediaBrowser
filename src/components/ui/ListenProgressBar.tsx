import { memo } from 'react';
import { useSelector } from 'react-redux';
import { ProgressStrip } from '@/components/ui/ProgressStrip';
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

  return <ProgressStrip fraction={fraction} accessibilityLabel="Listening progress" />;
});
