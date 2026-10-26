import { useState } from 'react';
import { logger } from '@/scripts/Logger';
import type { dataSources } from '@/scripts/libraryUtils';
import { hasProviderKey, searchProvider } from '@/scripts/posterSources';
import type { ProviderCredentials, ProviderSearchResult, TmdbSearchType } from '@/scripts/posterSources';

/**
 * Search state shared by the poster and re-match screens: selected provider,
 * query text, normalised results, busy flag and error message.
 */
export function useProviderSearch(
  initialProvider: dataSources,
  initialQuery: string,
  credentials: ProviderCredentials,
) {
  const [provider, setProviderState] = useState<dataSources>(initialProvider);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<ProviderSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  /** Switch provider; results and errors belong to the previous provider so they are cleared. */
  const setProvider = (next: dataSources) => {
    setProviderState(next);
    setResults([]);
    setError('');
  };

  /** Run the search; `tmdbType` only applies to TMDB (TVDB always searches shows). */
  const search = async (tmdbType: TmdbSearchType) => {
    const trimmed = query.trim();
    if (!trimmed || !hasProviderKey(provider, credentials)) return;
    setSearching(true);
    setError('');
    setResults([]);
    try {
      const found = await searchProvider(provider, trimmed, tmdbType, credentials);
      setResults(found);
      if (found.length === 0) setError('No results found.');
    } catch (e) {
      logger.error('EditItem', `${provider.toUpperCase()} search failed`, e);
      setError(
        provider === 'tvdb'
          ? 'Search failed. Check your TVDB API key and connection.'
          : 'Search failed. Check your API key and connection.',
      );
    } finally {
      setSearching(false);
    }
  };

  return { provider, setProvider, query, setQuery, results, searching, error, setError, search };
}
