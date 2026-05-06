import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';

export type ListItemProps = {
  kind: 'folder' | 'file';
  label: string;
  rowHeight: number;
  editMode: boolean;
  isEditable: boolean;
  count?: number;
  onPress: () => void;
  onLongPress?: () => void;
};

export function ListItem({
  kind,
  label,
  rowHeight,
  editMode,
  isEditable,
  count,
  onPress,
  onLongPress,
}: ListItemProps) {
  // Choose icon: folder icon for show/season folders; movie icon for video files.
  const icon = kind === 'folder' ? '📁' : '🎬';

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.row, { height: rowHeight }]}
    >
      <ThemedText style={styles.icon}>{icon}</ThemedText>
      <ThemedText style={styles.label} numberOfLines={1}>{label}</ThemedText>
      {kind === 'folder' && count !== undefined && (
        <View
          style={styles.countBadge}
          accessibilityLabel={`${count} ${count === 1 ? 'episode' : 'episodes'}`}
        >
          <ThemedText style={styles.countBadgeText}>{count}</ThemedText>
        </View>
      )}
      {editMode && isEditable && (
        <ThemedText style={styles.editIcon}>✏️</ThemedText>
      )}
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
  icon: {
    fontSize: 20,
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
  editIcon: {
    fontSize: 14,
  },
});
