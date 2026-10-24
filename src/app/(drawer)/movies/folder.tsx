import { MediaBrowserScreen } from '@/components/MediaBrowserScreen';
import { useBrowseLocation } from '@/hooks/useBrowseLocation';

export default function MoviesFolderScreen() {
  const location = useBrowseLocation();
  return <MediaBrowserScreen mediaFilter="movies" location={location} />;
}
