import type { ReactNode } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { ThemedText } from '@/components/ThemedText';

const DIVIDER_COLOR = 'rgba(128,128,128,0.35)';

interface ResultRowProps {
  /** Thumbnail URL; when null the placeholder emoji is shown instead. */
  thumbUrl: string | null;
  /** Emoji shown in place of a missing thumbnail. */
  placeholderIcon: string;
  title: string;
  /** Extra muted lines under the title (e.g. author, year). */
  subtitles?: (string | number | null | undefined | false)[];
  /** Line under the subtitles; `statusHighlighted` styles it as a selected/current state. */
  status?: string;
  statusHighlighted?: boolean;
  /** Tint the whole row (current/just-chosen item). */
  highlighted?: boolean;
  /** Shows a ▲/▼ chevron on the right when defined. */
  expanded?: boolean;
  disabled?: boolean;
  onPress: () => void;
  /** Rendered below the header, e.g. a poster gallery. */
  children?: ReactNode;
}

/** A search/result list row: thumbnail, title, subtitles, status line, optional chevron and expandable body. */
export function ResultRow({
  thumbUrl,
  placeholderIcon,
  title,
  subtitles,
  status,
  statusHighlighted,
  highlighted,
  expanded,
  disabled,
  onPress,
  children,
}: ResultRowProps) {
  return (
    <View style={[styles.row, highlighted && styles.rowHighlighted]}>
      <TouchableOpacity style={styles.header} onPress={onPress} disabled={disabled}>
        {thumbUrl ? (
          <Image source={{ uri: thumbUrl }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <ThemedText style={styles.placeholderIcon}>{placeholderIcon}</ThemedText>
          </View>
        )}
        <View style={styles.info}>
          <ThemedText style={styles.title}>{title}</ThemedText>
          {(subtitles ?? []).map((line, i) =>
            line ? <ThemedText key={i} style={styles.subtitle}>{line}</ThemedText> : null,
          )}
          {status ? (
            <ThemedText style={statusHighlighted ? styles.statusHighlighted : styles.status}>{status}</ThemedText>
          ) : null}
        </View>
        {expanded !== undefined && (
          <ThemedText style={styles.chevron}>{expanded ? '▲' : '▼'}</ThemedText>
        )}
      </TouchableOpacity>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'column',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DIVIDER_COLOR,
  },
  rowHighlighted: {
    backgroundColor: 'rgba(10,126,164,0.12)',
    borderRadius: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  thumb: {
    width: 50,
    height: 75,
    borderRadius: 4,
    backgroundColor: '#333',
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderIcon: {
    fontSize: 24,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontWeight: '600',
    fontSize: 14,
  },
  subtitle: {
    opacity: 0.6,
    fontSize: 12,
  },
  status: {
    opacity: 0.6,
    fontSize: 12,
    marginTop: 2,
  },
  statusHighlighted: {
    color: '#0a7ea4',
    fontSize: 12,
    fontWeight: '600',
  },
  chevron: {
    fontSize: 12,
    opacity: 0.6,
    paddingHorizontal: 4,
  },
});
