import { store } from '@/store/store';
import { setLibrarySink } from '@/scripts/librarySink';

// Hands the real store to the scanning/enrichment services, which depend only on the
// narrow `LibrarySink` interface instead of importing the store themselves.
// Imported for its side effect by the root layout, so it runs once at startup,
// before any screen can trigger a scan or enrichment.
setLibrarySink(store);
