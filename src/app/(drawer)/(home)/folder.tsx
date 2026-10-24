import { MediaBrowserScreen } from '@/components/MediaBrowserScreen';
import { useBrowseLocation } from '@/hooks/useBrowseLocation';

export default function HomeFolderScreen() {
  const location = useBrowseLocation();
  return <MediaBrowserScreen mediaFilter="all" location={location} />;
}
