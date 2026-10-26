import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { AudioTrack, SubtitleTrack } from 'expo-video';
import { sameTrack, trackLabels } from '@/scripts/VideoPlayback';

interface VideoTrackPickerProps {
  subtitleTracks: SubtitleTrack[];
  subtitleTrack: SubtitleTrack | null;
  audioTracks: AudioTrack[];
  audioTrack: AudioTrack | null;
  /** Null turns subtitles off. */
  onSelectSubtitle: (track: SubtitleTrack | null) => void;
  onSelectAudio: (track: AudioTrack) => void;
  onClose: () => void;
}

/** A full-screen dark sheet listing the embedded subtitle and audio tracks, the current ones marked. */
export function VideoTrackPicker({ subtitleTracks, subtitleTrack, audioTracks, audioTrack, onSelectSubtitle, onSelectAudio, onClose }: VideoTrackPickerProps) {
  const subtitleLabels = trackLabels(subtitleTracks);
  const audioLabels = trackLabels(audioTracks);
  return (
    <View style={[StyleSheet.absoluteFill, styles.sheet]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Subtitles</Text>
        <Option label="Off" selected={subtitleTrack === null} onPress={() => onSelectSubtitle(null)} />
        {subtitleTracks.map((track, i) => (
          <Option key={track.id ?? i} label={subtitleLabels[i]} selected={sameTrack(track, subtitleTrack)} onPress={() => onSelectSubtitle(track)} />
        ))}
        {audioTracks.length > 1 && (
          <>
            <Text style={[styles.heading, styles.headingSpaced]}>Audio</Text>
            {audioTracks.map((track, i) => (
              <Option key={track.id ?? i} label={audioLabels[i]} selected={sameTrack(track, audioTrack)} onPress={() => onSelectAudio(track)} />
            ))}
          </>
        )}
      </ScrollView>
      <TouchableOpacity style={styles.close} onPress={onClose} accessibilityRole="button">
        <Text style={styles.optionText}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}

function Option({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.option, selected && styles.optionSelected]} onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }}>
      <Text style={styles.optionText} numberOfLines={2}>{label}</Text>
      {selected && <Text style={styles.check}>✓</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: 'rgba(0, 0, 0, 0.85)', padding: 24, gap: 12 },
  scroll: { flex: 1 },
  content: { gap: 8, alignItems: 'stretch', paddingHorizontal: 12 },
  heading: { color: '#fff', fontSize: 18, fontWeight: '600', textAlign: 'center' },
  headingSpaced: { marginTop: 16 },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, backgroundColor: '#333' },
  optionSelected: { backgroundColor: '#4a4a4a' },
  optionText: { color: '#fff', fontSize: 16, flexShrink: 1 },
  check: { color: '#fff', fontSize: 16, fontWeight: '600' },
  close: { alignSelf: 'center', minWidth: 220, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, backgroundColor: '#333', alignItems: 'center' },
});
