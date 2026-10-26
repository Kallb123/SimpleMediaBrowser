import { StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';

/** The item's current TMDB / TVDB IDs as small badges; renders an empty row when neither is set. */
export function ProviderIdBadges({ tmdbId, tvdbId }: { tmdbId: string | null; tvdbId: string | null }) {
  return (
    <View style={styles.providerBadgeRow}>
      {tmdbId && (
        <View style={styles.providerBadge}>
          <ThemedText style={styles.providerBadgeText}>TMDB ID: {tmdbId}</ThemedText>
        </View>
      )}
      {tvdbId && (
        <View style={[styles.providerBadge, styles.providerBadgeTvdb]}>
          <ThemedText style={styles.providerBadgeText}>TVDB ID: {tvdbId}</ThemedText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  providerBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  providerBadge: {
    backgroundColor: 'rgba(10,126,164,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  providerBadgeTvdb: {
    backgroundColor: 'rgba(0,180,120,0.15)',
  },
  providerBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    opacity: 0.8,
  },
});
