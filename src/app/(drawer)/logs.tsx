import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Share, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { logger } from '@/scripts/Logger';
import { useColorScheme } from '@/hooks/useColorScheme';

const REFRESH_INTERVAL_MS = 2000;

type LogFilter = 'ALL' | 'LOG' | 'WARN' | 'ERROR';

export default function LogsScreen() {
    const colorScheme = useColorScheme() ?? 'light';
    const isDark = colorScheme === 'dark';

    const [lines, setLines] = useState<readonly string[]>([]);
    const [autoScroll, setAutoScroll] = useState(true);
    const [filter, setFilter] = useState<LogFilter>('ALL');
    const [searchText, setSearchText] = useState('');
    const scrollRef = useRef<ScrollView>(null);

    const refresh = useCallback(() => {
        setLines(logger.getLines());
    }, []);

    // Auto-refresh while the screen is mounted.
    useEffect(() => {
        refresh();
        const id = setInterval(refresh, REFRESH_INTERVAL_MS);
        return () => clearInterval(id);
    }, [refresh]);

    // Scroll to bottom whenever lines change (if auto-scroll is on).
    useEffect(() => {
        if (autoScroll) {
            scrollRef.current?.scrollToEnd({ animated: false });
        }
    }, [lines, autoScroll]);

    const handleShare = useCallback(async () => {
        const text = logger.getLogs();
        try {
            await Share.share({
                title: 'SimpleMediaBrowser debug log',
                message: text || '(log is empty)',
            });
        } catch {
            // User dismissed – ignore.
        }
    }, []);

    const handleClear = useCallback(async () => {
        await logger.clearLogs();
        logger.log('Logs', 'Log cleared by user');
        refresh();
    }, [refresh]);

    const lineColor = (line: string): string => {
        if (line.includes('[ERROR]')) return isDark ? '#FF6B6B' : '#CC0000';
        if (line.includes('[WARN ]')) return isDark ? '#FFD93D' : '#996600';
        return isDark ? '#ECEDEE' : '#11181C';
    };

    const searchLower = searchText.toLowerCase();
    const filteredLines = lines
        .filter((line) => {
            if (filter === 'ERROR') return line.includes('[ERROR]');
            if (filter === 'WARN') return line.includes('[WARN ]');
            if (filter === 'LOG') return line.includes('[LOG  ]');
            return true;
        })
        .filter((line) => searchLower === '' || line.toLowerCase().includes(searchLower));

    const filterButtons: { label: string; value: LogFilter }[] = [
        { label: 'All', value: 'ALL' },
        { label: 'Info', value: 'LOG' },
        { label: 'Warn', value: 'WARN' },
        { label: 'Error', value: 'ERROR' },
    ];

    return (
        <ThemedView style={styles.container}>
            {/* Toolbar */}
            <View style={[styles.toolbar, { backgroundColor: isDark ? '#1E1E1E' : '#F0F0F0' }]}>
                <TouchableOpacity onPress={refresh} style={styles.toolbarButton}>
                    <ThemedText style={styles.toolbarButtonText}>↺ Refresh</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                    onPress={() => setAutoScroll((v: boolean) => !v)}
                    style={[styles.toolbarButton, autoScroll && styles.toolbarButtonActive]}
                >
                    <ThemedText style={styles.toolbarButtonText}>
                        {autoScroll ? '⏬ Auto' : '⏸ Auto'}
                    </ThemedText>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleShare} style={styles.toolbarButton}>
                    <ThemedText style={styles.toolbarButtonText}>⬆ Share</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleClear} style={[styles.toolbarButton, styles.toolbarButtonDanger]}>
                    <ThemedText style={[styles.toolbarButtonText, styles.toolbarButtonTextDanger]}>✕ Clear</ThemedText>
                </TouchableOpacity>
            </View>

            {/* Level filter */}
            <View style={[styles.filterBar, { backgroundColor: isDark ? '#1E1E1E' : '#F0F0F0' }]}>
                {filterButtons.map(({ label, value }) => (
                    <TouchableOpacity
                        key={value}
                        onPress={() => setFilter(value)}
                        style={[styles.filterButton, filter === value && styles.filterButtonActive]}
                    >
                        <ThemedText style={[styles.filterButtonText, filter === value && styles.filterButtonTextActive]}>
                            {label}
                        </ThemedText>
                    </TouchableOpacity>
                ))}
            </View>

            {/* String search filter */}
            <View style={[styles.searchBar, { backgroundColor: isDark ? '#1E1E1E' : '#F0F0F0' }]}>
                <TextInput
                    style={[styles.searchInput, {
                        backgroundColor: isDark ? '#2C2C2C' : '#FFFFFF',
                        color: isDark ? '#ECEDEE' : '#11181C',
                        borderColor: isDark ? '#444' : '#CCC',
                    }]}
                    placeholder="Filter by text…"
                    placeholderTextColor={isDark ? '#888' : '#999'}
                    value={searchText}
                    onChangeText={setSearchText}
                    autoCapitalize="none"
                    autoCorrect={false}
                    clearButtonMode="while-editing"
                />
            </View>

            {/* File path hint */}
            <ThemedText style={styles.pathHint} numberOfLines={2}>
                File: {logger.getLogFilePath()}
            </ThemedText>

            {/* Log output */}
            <ScrollView
                ref={scrollRef}
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                onScrollBeginDrag={() => setAutoScroll(false)}
            >
                {filteredLines.length === 0 ? (
                    <ThemedText style={styles.emptyText}>
                        {lines.length === 0
                            ? 'No log entries yet.'
                            : 'No log entries match the current filter.'}
                    </ThemedText>
                ) : (
                    filteredLines.map((line: string, i: number) => (
                        <ThemedText
                            key={`${i}-${line.substring(0, 20)}`}
                            style={[styles.logLine, { color: lineColor(line) }]}
                            selectable
                        >
                            {line}
                        </ThemedText>
                    ))
                )}
            </ScrollView>
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    toolbar: {
        flexDirection: 'row',
        paddingHorizontal: 8,
        paddingVertical: 6,
        gap: 6,
        flexWrap: 'wrap',
    },
    filterBar: {
        flexDirection: 'row',
        paddingHorizontal: 8,
        paddingBottom: 6,
        gap: 6,
    },
    searchBar: {
        paddingHorizontal: 8,
        paddingBottom: 6,
    },
    searchInput: {
        height: 32,
        borderRadius: 6,
        borderWidth: 1,
        paddingHorizontal: 10,
        fontSize: 12,
        fontFamily: 'SpaceMono',
    },
    filterButton: {
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#4A90D9',
    },
    filterButtonActive: {
        backgroundColor: '#4A90D9',
    },
    filterButtonText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#4A90D9',
    },
    filterButtonTextActive: {
        color: '#FFFFFF',
    },
    toolbarButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: '#4A90D9',
    },
    toolbarButtonActive: {
        backgroundColor: '#2D6EAA',
    },
    toolbarButtonDanger: {
        backgroundColor: '#C0392B',
    },
    toolbarButtonText: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '600',
    },
    toolbarButtonTextDanger: {
        color: '#FFFFFF',
    },
    pathHint: {
        fontSize: 10,
        opacity: 0.5,
        paddingHorizontal: 8,
        paddingBottom: 4,
        fontFamily: 'SpaceMono',
    },
    scroll: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: 8,
        paddingBottom: 16,
    },
    logLine: {
        fontSize: 11,
        lineHeight: 16,
        fontFamily: 'SpaceMono',
    },
    emptyText: {
        opacity: 0.5,
        fontStyle: 'italic',
        padding: 16,
    },
});
