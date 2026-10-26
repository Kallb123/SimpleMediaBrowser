import { StyleSheet, View } from 'react-native';

export type ProgressStripProps = {
  /** 0..1 of the strip to fill. */
  fraction: number;
  accessibilityLabel: string;
};

/**
 * Thin progress strip overlaying the bottom edge of a cell or row (the poster box clips it to its
 * rounded corners). Shared by `ListenProgressBar` and `WatchProgressBar`.
 */
export function ProgressStrip({ fraction, accessibilityLabel }: ProgressStripProps) {
  return (
    <View
      style={styles.track}
      pointerEvents="none"
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
    >
      <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
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
