import { StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Href, Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { selectDirectory, selectPassword } from '@/store/settingsReducer';
import { FlashList } from '@shopify/flash-list';
import { FileInfo, getInfoAsync, StorageAccessFramework } from 'expo-file-system';

interface MediaObject {
  filename: string
  path: string
  parsedPath: string
  isDirectory: boolean
}

export default function HomeScreen() {
  const directory = useSelector(selectDirectory);
  const settingsPassword = useSelector(selectPassword);

  const [mediaList, setMediaList] = useState([] as MediaObject[]);

  useEffect(() => {
    // Check whether there's a directory to read
    if (!directory) {
      return;
    }

    checkMediaContents();
  }, [directory]);

  const checkMediaContents = async () => {
    const contents = await StorageAccessFramework.readDirectoryAsync(directory);

    var contentInfo = await Promise.all(contents.map(async (c) => {
        try {
          const info = await getInfoAsync(c);
          return info;
        } catch (e) {

        }
        const info: FileInfo = {uri: c, isDirectory: true, exists: true, size: 0, modificationTime: 0};
        return info;
    }));

    const allContents: MediaObject[] = contentInfo.map((c) => {
      const uri = decodeURIComponent(c.uri);
      const filename = uri.substring(uri.lastIndexOf('/') + 1, uri.length)
      return {
        filename: filename,
        path: c.uri,
        parsedPath: uri,
        isDirectory: c.isDirectory
      }
    });

    const filtered = allContents.filter((c) => {
      if (c.filename.charAt(0) === '.') return null;
      return c;
    })

    setMediaList(filtered);
  }

  return (
    <View>
      {directory && mediaList && mediaList.length > 0 ? (
      <ThemedView style={styles.listContainer}>
        <ThemedText type="title">Current Folder</ThemedText>
        <FlashList
          data={mediaList}
          renderItem={({ item }) => {
            return (
              <ThemedText><Link href={item.path as Href}>{item.filename}</Link></ThemedText>
            )
          }}
          estimatedItemSize={200}
        />
      </ThemedView>
      ) : (
        <ThemedView style={styles.stepContainer}>
          <ThemedText type="subtitle">Problem</ThemedText>
          {
            directory ? (
              <ThemedText>
                Your library directory is empty or invalid, set it up in <Link href={settingsPassword ? "/(drawer)/settingsprompt" : "/settings"}>Settings</Link>.
              </ThemedText>
            ) : (
              <ThemedText>
                You need to set up a library directory in <Link href={settingsPassword ? "/(drawer)/settingsprompt" : "/settings"}>Settings</Link>.
              </ThemedText>
            )
          }
        </ThemedView>
      )}
      {/* <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">SimpleMediaBrowser Home</ThemedText>
      </ThemedView>
      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Step 1: Try it</ThemedText>
        <ThemedText>
          <Link href="/modal">Present modal</Link>
        </ThemedText>
      </ThemedView>
      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Step 2: Explore</ThemedText>
        <ThemedText>
          Tap the Explore tab to learn more about what's included in this starter app.
        </ThemedText>
      </ThemedView>
      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Step 3: Get a fresh start</ThemedText>
        <ThemedText>
          When you're ready, run{' '}
          <ThemedText type="defaultSemiBold">npm run reset-project</ThemedText> to get a fresh{' '}
          <ThemedText type="defaultSemiBold">app</ThemedText> directory. This will move the current{' '}
          <ThemedText type="defaultSemiBold">app</ThemedText> to{' '}
          <ThemedText type="defaultSemiBold">app-example</ThemedText>.
        </ThemedText>
      </ThemedView> */}
    </View>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepContainer: {
    gap: 8,
    marginBottom: 8,
  },
  listContainer: {
    height: "100%",
  },
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: 'absolute',
  },
});
