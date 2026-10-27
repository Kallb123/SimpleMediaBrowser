import { MediaBrowserScreen } from '@/components/MediaBrowserScreen';
import { useBrowseLocation } from '@/hooks/useBrowseLocation';

export default function PersonalFolderScreen() {
  const location = useBrowseLocation();
  return <MediaBrowserScreen mediaFilter="personal" location={location} />;
}
