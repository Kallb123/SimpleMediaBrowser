import { useLocalSearchParams, router, Stack } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import { usePreventRemove, useNavigation } from '@react-navigation/native';
import { Alert, Button, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { ThemedText } from '@/components/ThemedText';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import { ThemedView } from '@/components/ThemedView';
import { ProviderIdBadges } from '@/components/edit/ProviderIdBadges';
import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { setMediaOverride } from '@/store/libraryReducer';
import { useEditTarget, itemTypeLabel, type EditItemType } from '@/hooks/useEditTarget';
import { KeyboardAwareForm } from '@/components/KeyboardAwareForm';
import { useKeyboardAwareScroll } from '@/hooks/useKeyboardAwareScroll';
import { logger } from '@/scripts/Logger';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DIVIDER_COLOR = 'rgba(128,128,128,0.35)';

export default function EditItemScreen() {
  const { itemType, itemKey, currentTitle } = useLocalSearchParams<{
    itemType: EditItemType;
    itemKey: string;
    currentTitle: string;
  }>();

  const dispatch = useDispatch();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  // The native header sits above this screen's content but outside this
  // component's own layout tree, so KeyboardAvoidingView can't discover its
  // height on its own — react-native-keyboard-controller's `automaticOffset`
  // heuristic (view-position-in-window measurement) still came up short by
  // roughly the header's height on-device. useHeaderHeight() reads the
  // actual rendered header height from React Navigation directly.
  const headerHeight = useHeaderHeight();
  const keyboard = useKeyboardAwareScroll();
  const { handleInputFocus, handleInputBlur } = keyboard;

  const { override: existingOverride, currentPoster, currentTmdbId, currentTvdbId, hasProviderSupport } =
    useEditTarget(itemType, itemKey);

  const [titleInput, setTitleInput] = useState(existingOverride.title ?? currentTitle ?? '');
  const [sortTitleInput, setSortTitleInput] = useState(existingOverride.sortTitle ?? '');
  // Year override – used for audiobooks as an edition/narrator proxy (different
  // narrator releases usually have different years and different cover art).
  const [yearInput, setYearInput] = useState(existingOverride.year ? String(existingOverride.year) : '');
  // Set by Save; lets the unsaved-changes guard step aside before navigating back.
  const [saved, setSaved] = useState(false);

  const isAudiobook = itemType === 'audiobook';
  const hasPoster = itemType === 'show' || itemType === 'movie' || isAudiobook;
  const isDirty =
    titleInput.trim() !== (existingOverride.title ?? currentTitle ?? '').trim() ||
    sortTitleInput.trim() !== (existingOverride.sortTitle ?? '') ||
    (isAudiobook && yearInput.trim() !== (existingOverride.year ? String(existingOverride.year) : ''));

  useEffect(() => {
    const overridesSummary = Object.keys(existingOverride).length > 0
      ? JSON.stringify(existingOverride)
      : 'none';
    logger.log('EditItem', `Screen opened – type=${itemType} key="${itemKey}" title="${currentTitle}" existingOverrides=${overridesSummary}`);
  // Log only once on mount; params come from navigation and do not change during the screen's lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The cover screen adopts an edition's year into the stored override. Pull it
  // into a blank draft so Save doesn't wipe it.
  useEffect(() => {
    if (isAudiobook && existingOverride.year) {
      setYearInput((prev) => (prev.trim() ? prev : String(existingOverride.year)));
    }
  }, [isAudiobook, existingOverride.year]);

  // Block leaving (back button, swipe, header back) while the draft has unsaved
  // edits. Pushing the poster/re-match screens doesn't remove this one, so the
  // draft survives those trips. `preventRemove` is read from the latest render
  // by the beforeRemove listener, so once Save has re-rendered with `saved`
  // set, the guard is off and the router.back() below goes through silently.
  usePreventRemove(isDirty && !saved, ({ data }) => {
    Alert.alert('Discard changes?', 'You have unsaved changes to this item.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  useEffect(() => {
    if (saved) router.back();
  }, [saved]);

  const handleSave = () => {
    logger.log('EditItem', `Saving overrides for ${itemKey}: title="${titleInput}" sortTitle="${sortTitleInput}"`);
    const override: { title?: string; sortTitle?: string; year?: number } = {
      title: titleInput.trim() || undefined,
      sortTitle: sortTitleInput.trim() || undefined,
    };
    // Year is editable for audiobooks only (edition/narrator proxy). Only set the
    // key for audiobooks so a blank field never clears a year fetched during a
    // TV/movie rematch.
    if (isAudiobook) {
      const parsedYear = parseInt(yearInput.trim(), 10);
      override.year = Number.isFinite(parsedYear) && parsedYear > 0 ? parsedYear : undefined;
    }
    dispatch(setMediaOverride({ key: itemKey, override }));
    setSaved(true);
  };

  const handleChoosePoster = () => {
    router.push({
      pathname: '/editposter',
      params: { itemType, itemKey, currentTitle, query: titleInput.trim(), year: yearInput.trim() },
    });
  };

  const handleRematch = () => {
    router.push({ pathname: '/editrematch', params: { itemType, itemKey, currentTitle } });
  };

  return (
    <ThemedView style={styles.screen}>
      <KeyboardAwareForm
        keyboard={keyboard}
        keyboardVerticalOffset={headerHeight}
        avoidingViewStyle={styles.container}
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: 16 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <Stack.Screen options={{ headerRight: () => <Button title="Save" onPress={handleSave} /> }} />
        <View style={styles.header}>
          <ThemedText type="subtitle">Edit {itemTypeLabel(itemType)}</ThemedText>
          <ThemedText style={styles.subtitle} numberOfLines={2}>{currentTitle}</ThemedText>
        </View>

        {/* Title override */}
        <View style={styles.section}>
          <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Title</ThemedText>
          <View style={styles.field}>
            <ThemedText style={styles.label}>Display Title</ThemedText>
            <ThemedTextInput
              value={titleInput}
              onChangeText={setTitleInput}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              placeholder="Override display title"
            />
          </View>
          <View style={styles.field}>
            <ThemedText style={styles.label}>Sort Title</ThemedText>
            <ThemedTextInput
              value={sortTitleInput}
              onChangeText={setSortTitleInput}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              placeholder="Override sort order (e.g. 'Dark Knight, The')"
            />
            <ThemedText style={styles.hint}>
              Used to order the item in the grid. Leave empty to sort by display title.
            </ThemedText>
          </View>
          {isAudiobook && (
            <View style={styles.field}>
              <ThemedText style={styles.label}>Year</ThemedText>
              <ThemedTextInput
                value={yearInput}
                onChangeText={setYearInput}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
                placeholder="Release year (e.g. 2012)"
                keyboardType="number-pad"
              />
              <ThemedText style={styles.hint}>
                Different narrator editions usually have different release years and
                cover art. Set the year to help the cover search surface the right
                edition first.
              </ThemedText>
            </View>
          )}
        </View>

        {/* Poster/cover (shows, movies and audiobooks); picked on its own screen */}
        {hasPoster && (
          <View style={styles.section}>
            <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>
              {isAudiobook ? 'Cover' : 'Poster'}
            </ThemedText>

            {currentPoster ? (
              <Image
                source={{ uri: currentPoster }}
                style={styles.posterPreview}
                contentFit="contain"
              />
            ) : (
              <View style={styles.posterPlaceholder}>
                <ThemedText style={styles.placeholderIcon}>{isAudiobook ? '🎧' : '🎬'}</ThemedText>
                <ThemedText style={styles.hint}>{isAudiobook ? 'No cover set' : 'No poster set'}</ThemedText>
              </View>
            )}

            <TouchableOpacity style={styles.actionButton} onPress={handleChoosePoster}>
              <ThemedText style={styles.actionButtonText}>
                {isAudiobook ? 'Choose cover…' : 'Choose poster…'}
              </ThemedText>
            </TouchableOpacity>
            <ThemedText style={styles.hint}>
              Picking a {isAudiobook ? 'cover' : 'poster'} applies it immediately; it isn&apos;t part of Save.
            </ThemedText>
          </View>
        )}

        {/* Metadata match (shows and movies only, requires API key) */}
        {hasProviderSupport && (
          <View style={styles.section}>
            <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Metadata Match</ThemedText>
            <ProviderIdBadges tmdbId={currentTmdbId} tvdbId={currentTvdbId} />
            <TouchableOpacity style={styles.actionButton} onPress={handleRematch}>
              <ThemedText style={styles.actionButtonText}>Re-match metadata…</ThemedText>
            </TouchableOpacity>
            <ThemedText style={styles.hint}>
              Re-matching applies immediately; it isn&apos;t part of Save.
            </ThemedText>
          </View>
        )}

        {!hasProviderSupport && (itemType === 'show' || itemType === 'movie') && (
          <View style={styles.section}>
            <ThemedText style={styles.hint}>
              Add a TMDB or TVDB API key in Settings to enable poster search and metadata re-matching.
            </ThemedText>
          </View>
        )}
      </KeyboardAwareForm>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 20,
  },
  header: {
    gap: 4,
    paddingBottom: 4,
  },
  subtitle: {
    opacity: 0.6,
    fontSize: 13,
  },
  section: {
    gap: 10,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DIVIDER_COLOR,
  },
  sectionTitle: {
    fontSize: 15,
    marginBottom: 2,
  },
  field: {
    gap: 6,
  },
  label: {
    fontWeight: '600',
    fontSize: 14,
  },
  hint: {
    opacity: 0.6,
    fontSize: 12,
    fontStyle: 'italic',
  },
  posterPreview: {
    width: 120,
    height: 180,
    borderRadius: 6,
    backgroundColor: '#222',
    alignSelf: 'center',
  },
  posterPlaceholder: {
    width: 120,
    height: 180,
    borderRadius: 6,
    backgroundColor: '#333',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  placeholderIcon: {
    fontSize: 24,
  },
  actionButton: {
    backgroundColor: '#0a7ea4',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
});
