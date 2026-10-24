import { MediaBrowserScreen } from '@/components/MediaBrowserScreen';
import { useBrowseLocation } from '@/hooks/useBrowseLocation';

export default function AudiobooksFolderScreen() {
  const location = useBrowseLocation();
  return <MediaBrowserScreen mediaFilter="audiobooks" location={location} />;
}
