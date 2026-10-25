import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { WatchedBadge } from '@/components/ui/WatchedBadge';
import type { ToggleWatched } from '@/components/ui/WatchedBadge';

export type ListItemProps = {
  kind: 'folder' | 'file';
  label: string;
  rowHeight: number;
  editMode: boolean;
  isEditable: boolean;
  isSelected?: boolean;
  count?: number;
  /** 1-based part number of an audiobook file; shown in place of the icon. */
  partNumber?: number;
  /** A file's watched key (its `parsedPath`); a folder passes `watchKeys` instead. */
  watchKey?: string;
  watchKeys?: () => readonly string[];
  onToggleWatched?: ToggleWatched;
  onPress: () => void;
  onLongPress?: () => void;
  onEditPress?: () => void;
};

export function ListItem({
  kind,
  label,
  rowHeight,
  editMode,
  isEditable,
  isSelected,
  count,
  partNumber,
  watchKey,
  watchKeys,
  onToggleWatched,
  onPress,
  onLongPress,
  onEditPress,
}: ListItemProps) {
  // Choose icon: folder icon for show/season folders; part number for audiobook parts;
  // movie icon for other files.
  const showPartNumber = kind === 'file' && partNumber !== undefined;
  const icon = kind === 'folder' ? '📁' : showPartNumber ? String(partNumber) : '🎬';

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.row, { height: rowHeight }, isSelected && styles.rowSelected]}
    >
      <ThemedText
        style={[styles.icon, showPartNumber && styles.iconPartNumber]}
        accessibilityLabel={showPartNumber ? `Part ${partNumber}` : undefined}
      >
        {icon}
      </ThemedText>
      <ThemedText style={styles.label} numberOfLines={1}>{label}</ThemedText>
      <WatchedBadge
        variant="list"
        watchKey={watchKey}
        watchKeys={watchKeys}
        editable={editMode}
        onToggle={onToggleWatched}
      />
      {kind === 'folder' && count !== undefined && (
        <View
          style={styles.countBadge}
          accessibilityLabel={`${count} ${count === 1 ? 'episode' : 'episodes'}`}
        >
          <ThemedText style={styles.countBadgeText}>{count}</ThemedText>
        </View>
      )}
      {isSelected ? (
        <ThemedText style={styles.selectedIcon}>✓</ThemedText>
      ) : editMode && isEditable ? (
        <TouchableOpacity style={styles.editButton} onPress={onEditPress} activeOpacity={0.7}>
          <ThemedText style={styles.editIcon}>✏️</ThemedText>
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.3)',
  },
  rowSelected: {
    backgroundColor: 'rgba(10,126,164,0.18)',
  },
  icon: {
    fontSize: 20,
  },
  // Fixed-width centred column so labels stay aligned whatever the number of digits.
  iconPartNumber: {
    width: 28,
    textAlign: 'center',
    fontWeight: '700',
  },
  label: {
    flex: 1,
    fontSize: 14,
  },
  countBadge: {
    backgroundColor: 'rgba(128,128,128,0.25)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  editButton: {
    backgroundColor: 'rgba(10,126,164,0.85)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  editIcon: {
    fontSize: 16,
  },
  selectedIcon: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0a7ea4',
  },
});
