import {
  AUDIO_EXTENSIONS,
  NON_DIRECTORY_EXTENSIONS,
  VIDEO_EXTENSIONS,
  buildTmdbSearchQuery,
  fuzzyKey,
  isMediaFile,
  normalizeShowName,
  parseFilename,
  parseFromPath,
} from '../libraryUtils';

describe('normalizeShowName', () => {
  it.each([
    // [raw, name, year]
    ['Bluey (2018)', 'Bluey', 2018],
    ['Bluey [2018]', 'Bluey', 2018],
    ['Bluey 2018', 'Bluey', 2018],
    ['Bluey', 'Bluey', 0],
    ['Bluey(2018)', 'Bluey', 2018],
    ['Bluey   (2018)   ', 'Bluey', 2018],
    ['  Bluey  ', 'Bluey', 0],
    ['', '', 0],
    // Only the trailing year is stripped.
    ['2012 Movie Night', '2012 Movie Night', 0],
    ['Show (2018) Extras', 'Show (2018) Extras', 0],
    // Non-4-digit numbers are not years.
    ['Apollo 13', 'Apollo 13', 0],
    ['Fahrenheit 451', 'Fahrenheit 451', 0],
    ['Show (18)', 'Show (18)', 0],
    // Mismatched brackets are not treated as a year at all.
    ['Show (2018]', 'Show (2018]', 0],
    ['Show [2018)', 'Show [2018)', 0],
  ])('normalizeShowName(%j) -> name %j, year %d', (raw, name, year) => {
    expect(normalizeShowName(raw)).toEqual({ name, year });
  });

  // NOTE: when the whole name is a year the "empty name" guard keeps the raw text
  // as the name, but the year is still reported as that year too.
  it.each([
    ['1923', '1923', 1923],
    ['2012', '2012', 2012],
    ['(2018)', '(2018)', 2018],
    ['[1999]', '[1999]', 1999],
    ['  1923  ', '1923', 1923],
  ])('a name that is only a year (%j) is kept as the name and also reported as the year', (raw, name, year) => {
    expect(normalizeShowName(raw)).toEqual({ name, year });
  });

  // NOTE: suspected bug (no word boundary / no "is this a title" check) - a title that
  // legitimately ends in a 4-digit number is split into name + "year", and a longer digit
  // run loses its leading digits. Pinned to current behaviour.
  it.each([
    ['Blade Runner 2049', 'Blade Runner', 2049],
    ['Space: 1999', 'Space:', 1999],
    ['Show12345', 'Show1', 2345],
    ['Show1999', 'Show', 1999],
    // "(" is not consumed by the mismatched-bracket case: bare year wins and "(" stays behind.
    ['Show (2018', 'Show (', 2018],
  ])('pins current year-stripping quirk for %j', (raw, name, year) => {
    expect(normalizeShowName(raw)).toEqual({ name, year });
  });
});

describe('fuzzyKey', () => {
  it.each([
    // Examples from the doc comment
    ["Grey's Anatomy", 'greys anatomy'],
    ['Greys Anatomy', 'greys anatomy'],
    ['Tom & Jerry', 'tom and jerry'],
    ['Tom and Jerry', 'tom and jerry'],
    ['Bluey (2018)', 'bluey'],
    // Case
    ['BLUEY', 'bluey'],
    ['bLuEy', 'bluey'],
    // Year suffix variants
    ['Bluey [2018]', 'bluey'],
    ['Bluey 2018', 'bluey'],
    // Punctuation removed
    ['Marvel: Agents', 'marvel agents'],
    ['Mr. Robot', 'mr robot'],
    ['Lost, Season', 'lost season'],
    ['Airplane!', 'airplane'],
    ['Spider-Man', 'spiderman'],
    // Whitespace collapsing and trimming
    ['  Mr    Robot  ', 'mr robot'],
    ['Mr\t\nRobot', 'mr robot'],
    ['', ''],
    // "&" without surrounding spaces still becomes " and " only if spaces exist; otherwise glued
    ['Tom&Jerry', 'tomandjerry'],
    // Removing punctuation can leave two spaces which are then collapsed
    ['Show - Name', 'show name'],
    ["Rock 'n' Roll", 'rock n roll'],
  ])('fuzzyKey(%j) -> %j', (input, expected) => {
    expect(fuzzyKey(input)).toBe(expected);
  });

  it('maps differently-written names of the same show onto one key', () => {
    const names = ["Grey's Anatomy", 'Greys Anatomy', "GREY'S ANATOMY (2005)", 'greys  anatomy [2005]'];
    expect(new Set(names.map(fuzzyKey)).size).toBe(1);
  });

  // NOTE: suspected gaps - these are not folded together by the current implementation.
  it.each([
    // Typographic apostrophe is not stripped, so it does not match the ASCII form.
    ['Grey’s Anatomy', 'grey’s anatomy'],
    // Hyphen is deleted (not replaced by a space), so "Spider-Man" != "Spider Man".
    ['Spider Man', 'spider man'],
    // "?" is not in the stripped set.
    ['Who?', 'who?'],
  ])('pins current non-folding behaviour for %j', (input, expected) => {
    expect(fuzzyKey(input)).toBe(expected);
  });
});

describe('buildTmdbSearchQuery', () => {
  it.each([
    ['Breaking Bad (2008)', 'Breaking Bad'],
    ['Breaking Bad [2008]', 'Breaking Bad'],
    ['Breaking Bad 2008', 'Breaking Bad'],
    ['Breaking Bad', 'Breaking Bad'],
    ['Tom & Jerry', 'Tom and Jerry'],
    ["Grey's Anatomy", 'Greys Anatomy'],
    ['Marvel: Agents of S.H.I.E.L.D.', 'Marvel Agents of SHIELD'],
    ['Lost, Found', 'Lost Found'],
    ['Spider-Man', 'SpiderMan'],
    ['  Mr    Robot  ', 'Mr Robot'],
    // Case is preserved (unlike fuzzyKey).
    ['BLUEY', 'BLUEY'],
    // Strips only at the end.
    ['2012 Movie Night', '2012 Movie Night'],
    ['', ''],
  ])('buildTmdbSearchQuery(%j) -> %j', (input, expected) => {
    expect(buildTmdbSearchQuery(input)).toBe(expected);
  });

  it('does not mutate / depend on anything but its argument', () => {
    const title = "Grey's Anatomy (2005)";
    buildTmdbSearchQuery(title);
    expect(title).toBe("Grey's Anatomy (2005)");
  });

  // NOTE: suspected bug - unlike normalizeShowName, there is no "empty result" guard, so a
  // title that is only a year (e.g. the TV show "1923" or the movie "2012") produces an
  // empty TMDB query. Also the year bracket handling is unbalanced ("(2008" is stripped).
  it.each([
    ['1923', ''],
    ['2012', ''],
    ['(2018)', ''],
    ['Blade Runner 2049', 'Blade Runner'],
    ['Show (2018', 'Show'],
    ['Show 2018)', 'Show'],
  ])('pins current behaviour for year-like titles %j -> %j', (input, expected) => {
    expect(buildTmdbSearchQuery(input)).toBe(expected);
  });
});

describe('isMediaFile', () => {
  it.each([
    ['episode.mkv', 'tv', true],
    ['episode.mp4', 'tv', true],
    ['episode.m2ts', 'tv', true],
    ['episode.mkv', 'movie', true],
    ['episode.mkv', undefined, true], // defaults to 'tv'
    ['EPISODE.MKV', 'tv', true],
    ['Episode.Mp4', 'movie', true],
    ['archive.tar.mkv', 'tv', true],
    ['episode.srt', 'tv', false],
    ['episode.jpg', 'movie', false],
    ['episode', 'tv', false],
    ['episode.', 'tv', false],
    ['', 'tv', false],
    ['song.mp3', 'tv', false],
    ['song.mp3', 'movie', false],
    ['song.mp3', 'audiobook', true],
    ['book.M4B', 'audiobook', true],
    ['book.opus', 'audiobook', true],
    ['book.flac', 'audiobook', true],
    ['book', 'audiobook', false],
    ['episode.mkv', 'audiobook', false],
    ['cover.jpg', 'audiobook', false],
    ['notes.txt', 'audiobook', false],
  ] as const)('isMediaFile(%j, %j) -> %s', (filename, sourceType, expected) => {
    expect(isMediaFile(filename, sourceType)).toBe(expected);
  });

  // NOTE: a bare dotfile is treated as "an extension with no name", so ".mkv" counts as media.
  it('treats a dotfile whose name is a media extension as media (current behaviour)', () => {
    expect(isMediaFile('.mkv', 'tv')).toBe(true);
    expect(isMediaFile('.mp3', 'audiobook')).toBe(true);
    expect(isMediaFile('.gitignore', 'tv')).toBe(false);
  });

  it('keeps video and audio extension sets disjoint, lower-case and dot-prefixed', () => {
    for (const ext of [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...NON_DIRECTORY_EXTENSIONS]) {
      expect(ext).toMatch(/^\.[a-z0-9]+$/);
    }
    for (const ext of AUDIO_EXTENSIONS) expect(VIDEO_EXTENSIONS.has(ext)).toBe(false);
    for (const ext of VIDEO_EXTENSIONS) expect(NON_DIRECTORY_EXTENSIONS.has(ext)).toBe(false);
  });
});

describe('parseFilename', () => {
  const ep = (showName: string, season: number, episode: number, title = '', extra: object = {}) => ({
    showName,
    rawShowName: showName,
    showYear: 0,
    season,
    episode,
    title,
    ...extra,
  });

  it.each([
    // SxxExx, all separators
    ['Show.Name.S01E05.Episode.Title.mkv', ep('Show Name', 1, 5, 'Episode Title')],
    ['Show Name S01E05 Episode Title.mkv', ep('Show Name', 1, 5, 'Episode Title')],
    ['Show-Name-S01E05-Episode-Title.mkv', ep('Show-Name', 1, 5, 'Episode-Title')],
    ['Show Name - S01E05 - Episode Title.mkv', ep('Show Name', 1, 5, 'Episode Title')],
    // Lower-case, mixed case
    ['show.name.s01e05.mkv', ep('show name', 1, 5)],
    ['Show.Name.s01E05.mkv', ep('Show Name', 1, 5)],
    ['Show.Name.S01e05.mkv', ep('Show Name', 1, 5)],
    // Digit widths
    ['Show.S1E5.mkv', ep('Show', 1, 5)],
    ['Show.S01E105.mkv', ep('Show', 1, 105)],
    ['Show.S12E24.mkv', ep('Show', 12, 24)],
    ['Show.S99E999.mkv', ep('Show', 99, 999)],
    ['Show.S00E01.Special.mkv', ep('Show', 0, 1, 'Special')],
    // No title after the episode token
    ['Show.Name.S02E10.mkv', ep('Show Name', 2, 10)],
    // Title with underscores/dots is cleaned, extension stripped
    ['Show.S01E01.Part_One.mkv', ep('Show', 1, 1, 'Part One')],
    ['Show.S01E01.Title.With.Many.Dots.mp4', ep('Show', 1, 1, 'Title With Many Dots')],
    // NxNN
    ['Show.Name.1x05.Episode.Title.mkv', ep('Show Name', 1, 5, 'Episode Title')],
    ['Show Name 2x10.mkv', ep('Show Name', 2, 10)],
    ['Show - 3x07 - Title.mkv', ep('Show', 3, 7, 'Title')],
    // SxxExx wins over NxNN when both are present
    ['Show.S01E02.3x04.mkv', ep('Show', 1, 2, '3x04')],
    // Different extension / no extension handling
    ['Show.S01E05.m4v', ep('Show', 1, 5)],
  ])('parses %j', (filename, expected) => {
    expect(parseFilename(filename)).toEqual(expected);
  });

  it.each([
    // Year suffix on the show name: stripped from name, kept in rawShowName/showYear
    ['Bluey (2018) S01E05 Title.mkv', { showName: 'Bluey', rawShowName: 'Bluey (2018)', showYear: 2018, season: 1, episode: 5, title: 'Title' }],
    ['Bluey [2018] - S01E05.mkv', { showName: 'Bluey', rawShowName: 'Bluey [2018]', showYear: 2018, season: 1, episode: 5, title: '' }],
    ['Bluey.2018.S01E05.mkv', { showName: 'Bluey', rawShowName: 'Bluey 2018', showYear: 2018, season: 1, episode: 5, title: '' }],
    ['Bluey.2018.2x03.Title.mkv', { showName: 'Bluey', rawShowName: 'Bluey 2018', showYear: 2018, season: 2, episode: 3, title: 'Title' }],
    // Numeric show names must not be mistaken for season/episode tokens
    ['24.S01E01.mkv', { showName: '24', rawShowName: '24', showYear: 0, season: 1, episode: 1, title: '' }],
    ['9-1-1.S02E03.Title.mkv', { showName: '9-1-1', rawShowName: '9-1-1', showYear: 0, season: 2, episode: 3, title: 'Title' }],
    ['3rd Rock From the Sun - 2x05 - Title.mkv', { showName: '3rd Rock From the Sun', rawShowName: '3rd Rock From the Sun', showYear: 0, season: 2, episode: 5, title: 'Title' }],
    ['2 Broke Girls S01E01.mkv', { showName: '2 Broke Girls', rawShowName: '2 Broke Girls', showYear: 0, season: 1, episode: 1, title: '' }],
    ['Show 1x1 2x2.mkv', { showName: 'Show', rawShowName: 'Show', showYear: 0, season: 1, episode: 1, title: '2x2' }],
    // NOTE: a name that is only a year is returned as the show name AND as the year.
    ['1923.S01E01.mkv', { showName: '1923', rawShowName: '1923', showYear: 1923, season: 1, episode: 1, title: '' }],
    ['2012.1x02.mkv', { showName: '2012', rawShowName: '2012', showYear: 2012, season: 1, episode: 2, title: '' }],
  ])('handles year-suffixed and numeric show names: %j', (filename, expected) => {
    expect(parseFilename(filename)).toEqual(expected);
  });

  it.each([
    ['Movie.2020.1080p.mkv'],
    ['Movie.1920x1080.mkv'],
    ['Movie.x264.AAC.mkv'],
    ['random file.mkv'],
    ['Show.Season.1.Episode.5.mkv'],
    ['Show.E05.mkv'],
    ['Show.S01.mkv'],
    ['Show.S1E5x.mkv'],
    // Season token wider than 2 digits / episode wider than 3
    ['Show.S100E01.mkv'],
    ['Show.S01E1000.mkv'],
    ['Show.100x01.mkv'],
    // Token must be preceded by a separator
    ['ShowS01E05.mkv'],
    ['Show1x05.mkv'],
    ['Se7en.mkv'],
    ['.mkv'],
    [''],
  ])('returns null for non-matching name %j', (filename) => {
    expect(parseFilename(filename)).toBeNull();
  });

  // NOTE: suspected bug - underscore is a regex word character, so the `\b` next to the
  // SxxExx / NxNN token never matches when "_" sits directly before or after it. Names that
  // use underscores as the separator (despite the doc comment) are not recognised at all.
  it.each([
    ['Show_Name_S01E05_Episode_Title.mkv'],
    ['Show_Name_S01E05.mkv'],
    ['Show.Name.S01E05_Title.mkv'],
    ['Show_Name_10x100_Title.avi'],
    ['Show_Name_1x05.mkv'],
  ])('does not recognise underscore-separated name %j', (filename) => {
    expect(parseFilename(filename)).toBeNull();
  });

  // NOTE: a multi-episode range is parsed as the first episode with the second as the title.
  it('parses "Show.S01E05-E06.mkv" as episode 5 with title "E06" (second episode lost)', () => {
    expect(parseFilename('Show.S01E05-E06.mkv')).toEqual(ep('Show', 1, 5, 'E06'));
  });

  // NOTE: suspected bugs/limitations, pinned to current behaviour. In every case the scanner
  // then falls back to parseFromPath (see FileScanner.parseMediaFile).
  it.each([
    // No show name: the pattern requires a separator before the SxxExx token.
    ['S01E05.mkv'],
    ['S01E05.Episode.Title.mkv'],
    ['1x05.mkv'],
    // Multi-episode files are not recognised.
    ['Show.S01E05E06.mkv'],
    // The "extension" strip eats the final dotted segment when there is no real extension.
    ['Show.S01E05'],
  ])('does not recognise %j', (filename) => {
    expect(parseFilename(filename)).toBeNull();
  });
});

describe('parseFromPath', () => {
  describe('path depth', () => {
    it('returns null for a file directly in the scan root (0 parts)', () => {
      expect(parseFromPath('episode.mkv', [])).toBeNull();
    });

    it('treats 1 part as the show folder with season defaulting to 1', () => {
      expect(parseFromPath('Some.Episode.mkv', ['Bluey'])).toEqual({
        showName: 'Bluey',
        rawShowName: 'Bluey',
        showYear: 0,
        season: 1,
        episode: 0,
        title: 'Some Episode',
      });
    });

    it('treats 2 parts as show / season folder', () => {
      expect(parseFromPath('Some.Episode.mkv', ['Bluey', 'Season 2'])).toEqual({
        showName: 'Bluey',
        rawShowName: 'Bluey',
        showYear: 0,
        season: 2,
        episode: 0,
        title: 'Some Episode',
      });
    });

    it('ignores any parts deeper than the season folder', () => {
      expect(parseFromPath('ep.mkv', ['Bluey', 'Season 2', 'Extras', 'Deleted'])).toMatchObject({
        showName: 'Bluey',
        season: 2,
      });
    });

    it('normalises a year-suffixed show folder but keeps the raw name and year', () => {
      expect(parseFromPath('ep.mkv', ['Bluey (2018)', 'Season 1'])).toMatchObject({
        showName: 'Bluey',
        rawShowName: 'Bluey (2018)',
        showYear: 2018,
      });
      expect(parseFromPath('ep.mkv', ['Bluey [2018]'])).toMatchObject({
        showName: 'Bluey',
        rawShowName: 'Bluey [2018]',
        showYear: 2018,
        season: 1,
      });
    });
  });

  describe('season folder naming', () => {
    it.each([
      ['Season 1', 1],
      ['Season 01', 1],
      ['Season1', 1],
      ['season 3', 3],
      ['SEASON 4', 4],
      ['Season 10', 10],
      ['Season 12 (2019)', 12],
      ['2019 Season 3', 3],
      // Falls back to the first run of digits
      ['S01', 1],
      ['S2', 2],
      ['s05', 5],
      ['Series 3', 3],
      ['Staffel 2', 2],
      ['Book 7', 7],
      ['3', 3],
      ['01', 1],
      // No digits at all defaults to season 1
      ['Specials', 1],
      ['Extras', 1],
      ['', 1],
    ])('season folder %j -> season %d', (folder, season) => {
      expect(parseFromPath('ep.mkv', ['Show', folder])?.season).toBe(season);
    });

    // NOTE: suspected limitation - the "first digit run" fallback picks up years and
    // disc numbers, and a "Specials" folder is folded into season 1 rather than season 0.
    it.each([
      ['Show 2018 Extras', 2018],
      ['2019', 2019],
      ['Disc 2 Season 1', 1], // "Season N" still wins
      ['Disc 2', 2],
      ['Season 1 Part 2', 1],
    ])('pins current behaviour for season folder %j -> %d', (folder, season) => {
      expect(parseFromPath('ep.mkv', ['Show', folder])?.season).toBe(season);
    });
  });

  describe('episode number from the filename', () => {
    it.each([
      ['Show.E05.mkv', 5],
      ['Show.e5.mkv', 5],
      ['Show E5 Title.mkv', 5],
      ['Show.EP12.mkv', 12],
      ['Show.ep7.mkv', 7],
      ['Show - Ep 12.mkv', 0], // "Ep 12" has a space, so no digits directly after it
      ['E123.mkv', 123],
      ['Show_E05_Title.mkv', 0], // "_" is a word character so there is no \b before E
      ['Show-E05-Title.mkv', 5],
      ['Show (E05).mkv', 5],
    ])('%j -> episode %d', (filename, episode) => {
      expect(parseFromPath(filename, ['Show', 'Season 1'])?.episode).toBe(episode);
    });

    // NOTE: suspected limitations pinned to current behaviour - only a standalone eNN/epNN
    // token is understood, so these all fall through to episode 0 (which collides on the
    // "e00" key in buildLibrary: only the first such file per season is stored).
    it.each([
      ['01.mkv'],
      ['Episode 5.mkv'],
      ['Episode05.mkv'],
      ['Show Name Title.mkv'],
      ['Show.E1000.mkv'],
      // SxxExx glued together: no word boundary before the "E"
      ['S01E05.mkv'],
      ['Show.Name.S01E05.mkv'],
    ])('does not extract an episode number from %j (falls back to 0)', (filename) => {
      expect(parseFromPath(filename, ['Show', 'Season 1'])?.episode).toBe(0);
    });
  });

  describe('title', () => {
    it.each([
      ['Pilot.mkv', 'Pilot'],
      ['The.Great.Escape.mkv', 'The Great Escape'],
      ['The_Great_Escape.mkv', 'The Great Escape'],
      ['The-Great-Escape.mkv', 'The Great Escape'],
      ['The.Great..Escape.mkv', 'The Great Escape'],
      ['Episode 5', 'Episode 5'],
      ['  Spaced.mkv', 'Spaced'],
      ['E05.Title.mp4', 'E05 Title'],
      // Only the last extension is stripped.
      ['archive.tar.mkv', 'archive tar'],
    ])('derives title from %j -> %j', (filename, title) => {
      expect(parseFromPath(filename, ['Show'])?.title).toBe(title);
    });
  });
});
