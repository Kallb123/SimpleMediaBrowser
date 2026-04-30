import { Linking, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Link } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { selectDirectory, selectMediaStructure, selectPassword } from '@/store/settingsReducer';
import { selectMediaLibrary } from '@/store/libraryReducer';
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

// ── Helper: build items to display from library + nav state ──────────────────

function buildDisplayItems(
  library: IMediaLibrary,
  viewType: viewTypes,
  navStack: NavLevel[],
  navigateInto: (entry: NavLevel) => void,
): DisplayItem[] {
  switch (viewType) {
    case 'flat': {
      // All episodes from every show/season in one flat list
      const items: DisplayItem[] = [];
      for (const show of Object.values(library)) {
        for (const season of Object.values(show.seasons)) {
          for (const ep of Object.values(season.episodes)) {
            items.push({
              kind: 'file',
              label: ep.title || ep.filename,
              key: ep.path,
              mediaObject: ep,
            });
          }
        }
      }
      return items;
    }

    case 'show': {
      if (navStack.length === 0) {
        // Root: one folder per show
        return Object.keys(library).sort().map((showName) => ({
          kind: 'folder',
          label: showName,
          key: showName,
          onPress: () => navigateInto({ label: showName, showName }),
        }));
      }
      // Inside a show: all episodes from every season
      const show = library[navStack[0].showName!];
      if (!show) return [];
      const items: DisplayItem[] = [];
      for (const season of Object.values(show.seasons)) {
        for (const ep of Object.values(season.episodes)) {
          items.push({
            kind: 'file',
            label: ep.title || ep.filename,
            key: ep.path,
            mediaObject: ep,
          });
        }
      }
      return items;
    }

    case 'show+season': {
      if (navStack.length === 0) {
        // Root: one folder per show+season combination
        const items: DisplayItem[] = [];
        for (const [showName, show] of Object.entries(library)) {
          for (const [seasonKey, season] of Object.entries(show.seasons)) {
            const label = `${showName} – Season ${season.seasonNumber}`;
            items.push({
              kind: 'folder',
              label,
              key: `${showName}::${seasonKey}`,
              onPress: () => navigateInto({ label, showName, seasonKey }),
            });
          }
        }
        return items.sort((a, b) => a.label.localeCompare(b.label));
      }
      // Inside a show+season folder: episodes of that season
      const { showName, seasonKey } = navStack[0];
      const season = library[showName!]?.seasons[seasonKey!];
      if (!season) return [];
      return Object.values(season.episodes).map((ep) => ({
        kind: 'file',
        label: ep.title || ep.filename,
        key: ep.path,
        mediaObject: ep,
      }));
    }

    case 'show/season':
    default: {
      if (navStack.length === 0) {
        // Root: one folder per show
        return Object.keys(library).sort().map((showName) => ({
          kind: 'folder',
          label: showName,
          key: showName,
          onPress: () => navigateInto({ label: showName, showName }),
        }));
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
              kind: 'folder',
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
        label: ep.title || ep.filename,
        key: ep.path,
        mediaObject: ep,
      }));
    }
  }
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const directory = useSelector(selectDirectory);
  const settingsPassword = useSelector(selectPassword);
  const viewType = useSelector(selectMediaStructure);
  const mediaLibrary = useSelector(selectMediaLibrary);

  const [navStack, setNavStack] = useState<NavLevel[]>([]);

  // Trigger a scan whenever the directory changes
  useEffect(() => {
    if (!directory) return;
    FileScanner.getInstance().scanFolder(directory);
  }, [directory]);

  // Reset navigation when viewType changes
  useEffect(() => {
    setNavStack([]);
  }, [viewType]);

  const navigateInto = (entry: NavLevel) => {
    setNavStack((prev: NavLevel[]) => [...prev, entry]);
  };

  const navigateBack = () => {
    setNavStack((prev: NavLevel[]) => prev.slice(0, -1));
  };

  const displayItems = useMemo(
    () => buildDisplayItems(mediaLibrary, viewType, navStack, navigateInto),
    [mediaLibrary, viewType, navStack],
  );

  const hasLibraryContent = Object.keys(mediaLibrary).length > 0;

  // Build breadcrumb label: "Home / Show / Season 1"
  const breadcrumb = ['Home', ...navStack.map((n: NavLevel) => n.label)].join(' › ');

  return (
    <View style={styles.container}>
      {directory && hasLibraryContent ? (
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
                  onPress={() => Linking.openURL(item.mediaObject.path).catch(() => {})}
                  style={styles.fileItem}
                >
                  <ThemedText>🎬 {item.label}</ThemedText>
                </TouchableOpacity>
              );
            }}
            estimatedItemSize={50}
          />
        </ThemedView>
      ) : (
        <ThemedView style={styles.stepContainer}>
          <ThemedText type="subtitle">Problem</ThemedText>
          {directory ? (
            <ThemedText>
              Your library directory is empty or invalid, set it up in{' '}
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

