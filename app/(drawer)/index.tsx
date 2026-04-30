import { Linking, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Link } from 'expo-router';
import { useEffect, useMemo, useCallback, useState } from 'react';
import { useSelector } from 'react-redux';
import { selectMediaSources, selectMediaStructure, selectPassword } from '@/store/settingsReducer';
import { selectMediaLibrary, selectMovies, selectIsScanning } from '@/store/libraryReducer';
import { FlashList } from '@shopify/flash-list';
import { FileScanner, IMediaObject } from '@/scripts/FileScanner';
import type { IMediaLibrary } from '@/store/libraryReducer';
import type { viewTypes } from '@/store/settingsReducer';

// ── Navigation types ─────────────────────────────────────────────────────────

type NavLevel = {
  label: string;
  showName?: string;
  seasonKey?: string;
};

type DisplayItem =
  | { kind: 'folder'; label: string; key: string; onPress: () => void }
  | { kind: 'file'; label: string; key: string; mediaObject: IMediaObject };

// ── Helper: format an episode label with episode number prefix ───────────────

function formatEpisodeLabel(ep: IMediaObject): string {
  if (ep.episodeNumber > 0) {
    const epNum = `E${String(ep.episodeNumber).padStart(2, '0')}`;
    return ep.title ? `${epNum} - ${ep.title}` : epNum;
  }
  return ep.title || ep.filename;
}

// ── Helper: build items to display from library + nav state ──────────────────

function buildDisplayItems(
  library: IMediaLibrary,
  movies: IMediaObject[],
  viewType: viewTypes,
  navStack: NavLevel[],
  navigateInto: (entry: NavLevel) => void,
): DisplayItem[] {
  switch (viewType) {
    case 'flat': {
      // All episodes from every show/season in one flat list, plus movies
      const items: DisplayItem[] = [];
      for (const show of Object.values(library)) {
        for (const season of Object.values(show.seasons)) {
          for (const ep of Object.values(season.episodes)) {
            items.push({
              kind: 'file',
              label: formatEpisodeLabel(ep),
              key: ep.path,
              mediaObject: ep,
            });
          }
        }
      }
      for (const movie of movies) {
        items.push({
          kind: 'file',
          label: movie.title || movie.filename,
          key: movie.path,
          mediaObject: movie,
        });
      }
      return items;
    }

    case 'show': {
      if (navStack.length === 0) {
        // Root: one folder per show + movie files
        const showFolders: DisplayItem[] = Object.keys(library).sort().map((showName) => ({
          kind: 'folder' as const,
          label: showName,
          key: showName,
          onPress: () => navigateInto({ label: showName, showName }),
        }));
        const movieItems: DisplayItem[] = movies.map((movie) => ({
          kind: 'file' as const,
          label: movie.title || movie.filename,
          key: movie.path,
          mediaObject: movie,
        }));
        return [...showFolders, ...movieItems];
      }
      // Inside a show: all episodes from every season
      const show = library[navStack[0].showName!];
      if (!show) return [];
      const items: DisplayItem[] = [];
      for (const season of Object.values(show.seasons)) {
        for (const ep of Object.values(season.episodes)) {
          items.push({
            kind: 'file',
            label: formatEpisodeLabel(ep),
            key: ep.path,
            mediaObject: ep,
          });
        }
      }
      return items;
    }

    case 'show+season': {
      if (navStack.length === 0) {
        // Root: one folder per show+season combination + movie files
        const showSeasonFolders: DisplayItem[] = [];
        for (const [showName, show] of Object.entries(library)) {
          for (const [seasonKey, season] of Object.entries(show.seasons)) {
            const label = `${showName} – Season ${season.seasonNumber}`;
            showSeasonFolders.push({
              kind: 'folder',
              label,
              key: `${showName}::${seasonKey}`,
              onPress: () => navigateInto({ label, showName, seasonKey }),
            });
          }
        }
        showSeasonFolders.sort((a, b) => a.label.localeCompare(b.label));
        const movieItems: DisplayItem[] = movies.map((movie) => ({
          kind: 'file' as const,
          label: movie.title || movie.filename,
          key: movie.path,
          mediaObject: movie,
        }));
        return [...showSeasonFolders, ...movieItems];
      }
      // Inside a show+season folder: episodes of that season
      const { showName, seasonKey } = navStack[0];
      const season = library[showName!]?.seasons[seasonKey!];
      if (!season) return [];
      return Object.values(season.episodes).map((ep) => ({
        kind: 'file',
        label: formatEpisodeLabel(ep),
        key: ep.path,
        mediaObject: ep,
      }));
    }

    case 'show/season':
    default: {
      if (navStack.length === 0) {
        // Root: one folder per show + movie files
        const showFolders: DisplayItem[] = Object.keys(library).sort().map((showName) => ({
          kind: 'folder' as const,
          label: showName,
          key: showName,
          onPress: () => navigateInto({ label: showName, showName }),
        }));
        const movieItems: DisplayItem[] = movies.map((movie) => ({
          kind: 'file' as const,
          label: movie.title || movie.filename,
          key: movie.path,
          mediaObject: movie,
        }));
        return [...showFolders, ...movieItems];
      }
      if (navStack.length === 1) {
        // Inside a show: one folder per season
        const show = library[navStack[0].showName!];
        if (!show) return [];
        return Object.entries(show.seasons)
          .sort((a, b) => a[1].seasonNumber - b[1].seasonNumber)
          .map(([seasonKey, season]) => {
            const label = `Season ${season.seasonNumber}`;
            return {
              kind: 'folder' as const,
              label,
              key: seasonKey,
              onPress: () =>
                navigateInto({
                  label,
                  showName: navStack[0].showName,
                  seasonKey,
                }),
            };
          });
      }
      // Inside a season: episodes
      const show = library[navStack[0].showName!];
      const season = show?.seasons[navStack[1].seasonKey!];
      if (!season) return [];
      return Object.values(season.episodes).map((ep) => ({
        kind: 'file',
        label: formatEpisodeLabel(ep),
        key: ep.path,
        mediaObject: ep,
      }));
    }
  }
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const mediaSources = useSelector(selectMediaSources);
  const settingsPassword = useSelector(selectPassword);
  const viewType = useSelector(selectMediaStructure);
  const mediaLibrary = useSelector(selectMediaLibrary);
  const movies = useSelector(selectMovies);

  const isScanning = useSelector(selectIsScanning);

  const [navStack, setNavStack] = useState<NavLevel[]>([]);
  useEffect(() => {
    if (!mediaSources || mediaSources.length === 0) return;
    FileScanner.getInstance().scanAllSources(mediaSources);
  }, [mediaSources]);

  // Reset navigation when viewType changes
  useEffect(() => {
    setNavStack([]);
  }, [viewType]);

  const navigateInto = useCallback((entry: NavLevel) => {
    setNavStack((prev: NavLevel[]) => [...prev, entry]);
  }, []);

  const navigateBack = useCallback(() => {
    setNavStack((prev: NavLevel[]) => prev.slice(0, -1));
  }, []);

  const displayItems = useMemo(
    () => buildDisplayItems(mediaLibrary, movies, viewType, navStack, navigateInto),
    [mediaLibrary, movies, viewType, navStack, navigateInto],
  );

  const hasLibraryContent = Object.keys(mediaLibrary).length > 0 || movies.length > 0;

  // Build breadcrumb label: "Home / Show / Season 1"
  const breadcrumb = ['Home', ...navStack.map((n: NavLevel) => n.label)].join(' › ');

  return (
    <View style={styles.container}>
      {mediaSources.length > 0 && hasLibraryContent ? (
        <ThemedView style={styles.listContainer}>
          {/* Breadcrumb / back navigation */}
          <ThemedView style={styles.breadcrumbRow}>
            {navStack.length > 0 && (
              <TouchableOpacity onPress={navigateBack} style={styles.backButton}>
                <ThemedText style={styles.backButtonText}>‹ Back</ThemedText>
              </TouchableOpacity>
            )}
            <ThemedText style={styles.breadcrumb} numberOfLines={1}>
              {breadcrumb}
            </ThemedText>
          </ThemedView>

          <FlashList
            data={displayItems}
            keyExtractor={(item: DisplayItem) => item.key}
            renderItem={({ item }: { item: DisplayItem }) => {
              if (item.kind === 'folder') {
                return (
                  <TouchableOpacity onPress={item.onPress} style={styles.folderItem}>
                    <ThemedText>📁 {item.label}</ThemedText>
                  </TouchableOpacity>
                );
              }
              return (
                <TouchableOpacity
                  onPress={() => Linking.openURL(item.mediaObject.path).catch((e) => console.error('Failed to open file:', e))}
                  style={styles.fileItem}
                >
                  <ThemedText>🎬 {item.label}</ThemedText>
                </TouchableOpacity>
              );
            }}
            estimatedItemSize={50}
          />
        </ThemedView>
      ) : isScanning ? (
        <ThemedView style={styles.stepContainer}>
          <ThemedText type="subtitle">Scanning…</ThemedText>
          <ThemedText>Scanning your library, please wait.</ThemedText>
        </ThemedView>
      ) : (
        <ThemedView style={styles.stepContainer}>
          <ThemedText type="subtitle">Problem</ThemedText>
          {mediaSources.length > 0 ? (
            <ThemedText>
              Your library directories are empty or invalid, check them in{' '}
              <Link href={settingsPassword ? '/(drawer)/settingsprompt' : '/settings'}>
                Settings
              </Link>
              .
            </ThemedText>
          ) : (
            <ThemedText>
              You need to set up a library directory in{' '}
              <Link href={settingsPassword ? '/(drawer)/settingsprompt' : '/settings'}>
                Settings
              </Link>
              .
            </ThemedText>
          )}
        </ThemedView>
      )}
    </View>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContainer: {
    flex: 1,
  },
  breadcrumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  backButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  breadcrumb: {
    flex: 1,
    fontSize: 14,
    opacity: 0.7,
  },
  folderItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  fileItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  stepContainer: {
    gap: 8,
    marginBottom: 8,
    padding: 16,
  },
});
