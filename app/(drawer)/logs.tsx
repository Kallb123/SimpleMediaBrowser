import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Share, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { logger } from '@/scripts/Logger';
import { useColorScheme } from '@/hooks/useColorScheme';

const REFRESH_INTERVAL_MS = 2000;

export default function LogsScreen() {
    const colorScheme = useColorScheme() ?? 'light';
    const isDark = colorScheme === 'dark';

    const [lines, setLines] = useState<readonly string[]>([]);
    const [autoScroll, setAutoScroll] = useState(true);
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
                {lines.length === 0 ? (
                    <ThemedText style={styles.emptyText}>No log entries yet.</ThemedText>
                ) : (
                    lines.map((line: string, i: number) => (
                        <ThemedText
                            key={i}
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
