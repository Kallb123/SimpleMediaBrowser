import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import type { BrowseLocation } from '@/components/MediaBrowserScreen';

/** Reads a media section `folder` route's params (as pushed by MediaBrowserScreen's navigateInto). */
export function useBrowseLocation(): BrowseLocation {
  const { label, title, showName, seasonKey, audiobookKey, personalFolder } = useLocalSearchParams<{
    label: string;
    title: string;
    showName?: string;
    seasonKey?: string;
    audiobookKey?: string;
    personalFolder?: string;
  }>();
  // Memoised on the param strings so the location keeps its identity across renders;
  // it feeds the memo behind the FlashList's `data`.
  return useMemo(
    () => ({ label, title, showName, seasonKey, audiobookKey, personalFolder }),
    [label, title, showName, seasonKey, audiobookKey, personalFolder],
  );
}
