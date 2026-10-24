import { MediaBrowserScreen } from '@/components/MediaBrowserScreen';
import { useBrowseLocation } from '@/hooks/useBrowseLocation';

export default function TVFolderScreen() {
  const location = useBrowseLocation();
  return <MediaBrowserScreen mediaFilter="tv" location={location} />;
}
