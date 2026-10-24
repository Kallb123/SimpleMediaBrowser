import {
  AUDIO_EXTENSIONS,
  NON_DIRECTORY_EXTENSIONS,
  VIDEO_EXTENSIONS,
  audioPartFiles,
  buildTmdbSearchQuery,
  episodeKeyFor,
  unnumberedEpisodeKey,
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

  // A name that is only a year is the title, not a release year: kept whole, year 0.
  it.each([
    ['1923', '1923'],
    ['2012', '2012'],
    ['(2018)', '(2018)'],
    ['[1999]', '[1999]'],
    ['  1923  ', '1923'],
  ])('a name that is only a year (%j) is kept as the name with year 0', (raw, name) => {
    expect(normalizeShowName(raw)).toEqual({ name, year: 0 });
  });

  // Only bracketed years count: a bare trailing number is part of the title.
  it.each([
    ['Bluey 2018', 'Bluey 2018', 0],
    ['Wonder Woman 1984', 'Wonder Woman 1984', 0],
    ['Bluey.2018', 'Bluey.2018', 0],
    ['Bluey_2018', 'Bluey_2018', 0],
    ['Blade Runner 2049', 'Blade Runner 2049', 0],
    ['Cyberpunk 2077', 'Cyberpunk 2077', 0],
    ['Space: 1999', 'Space: 1999', 0],
    ['Show - 2018', 'Show - 2018', 0],
    ['Show12345', 'Show12345', 0],
    ['Show1999', 'Show1999', 0],
    ['Show 12345', 'Show 12345', 0],
    ['Show 1899', 'Show 1899', 0],
    // Unbalanced brackets are never a year.
    ['Show (2018', 'Show (2018', 0],
    ['Show 2018)', 'Show 2018)', 0],
    // Implausible bracketed years are kept too.
    ['Show (2049)', 'Show (2049)', 0],
    ['Show [1234]', 'Show [1234]', 0],
    // Boundaries of the plausible range.
    ['Show (1899)', 'Show (1899)', 0],
    ['Show (1900)', 'Show', 1900],
    [`Show (${new Date().getFullYear() + 1})`, 'Show', new Date().getFullYear() + 1],
    [`Show (${new Date().getFullYear() + 2})`, `Show (${new Date().getFullYear() + 2})`, 0],
  ])('year rules for %j -> name %j, year %d', (raw, name, year) => {
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
    // A bare year is part of the name, so it is not folded away
    ['Bluey 2018', 'bluey 2018'],
    // Punctuation removed
    ['Marvel: Agents', 'marvel agents'],
    ['Mr. Robot', 'mr robot'],
    ['Lost, Season', 'lost season'],
    ['Airplane!', 'airplane'],
    ['Spider-Man', 'spider man'],
    // Whitespace collapsing and trimming
    ['  Mr    Robot  ', 'mr robot'],
    ['Mr\t\nRobot', 'mr robot'],
    ['', ''],
    // "&" without surrounding spaces still becomes " and " only if spaces exist; otherwise glued
    ['Tom&Jerry', 'tomandjerry'],
    // Removing punctuation can leave two spaces which are then collapsed
    ['Show - Name', 'show name'],
    ["Rock 'n' Roll", 'rock n roll'],
    // Typographic apostrophes and backtick fold like the ASCII one
    ['Grey’s Anatomy', 'greys anatomy'],
    ['Grey‘s Anatomy', 'greys anatomy'],
    ['Greyʼs Anatomy', 'greys anatomy'],
    ['Grey`s Anatomy', 'greys anatomy'],
    // Hyphen / dashes become a space (so "Spider-Man" != "Spiderman")
    ['Spider Man', 'spider man'],
    ['Spiderman', 'spiderman'],
    ['Spider–Man', 'spider man'],
    ['9-1-1', '9 1 1'],
    // More punctuation stripped
    ['Who?', 'who'],
    ['Hello; World', 'hello world'],
    ['The "Show"', 'the show'],
    ['The “Show”', 'the show'],
    ['To be continued…', 'to be continued'],
    // Title numbers are kept
    ['Wonder Woman 1984', 'wonder woman 1984'],
    ['Blade Runner 2049', 'blade runner 2049'],
    ['Space: 1999', 'space 1999'],
  ])('fuzzyKey(%j) -> %j', (input, expected) => {
    expect(fuzzyKey(input)).toBe(expected);
  });

  it('maps differently-written names of the same show onto one key', () => {
    const names = ["Grey's Anatomy", 'Greys Anatomy', "GREY'S ANATOMY (2005)", 'greys  anatomy [2005]', 'Grey’s Anatomy'];
    expect(new Set(names.map(fuzzyKey)).size).toBe(1);
    expect(fuzzyKey('Spider-Man')).toBe(fuzzyKey('Spider Man'));
  });
});

describe('buildTmdbSearchQuery', () => {
  it.each([
    ['Breaking Bad (2008)', 'Breaking Bad'],
    ['Breaking Bad [2008]', 'Breaking Bad'],
    ['Breaking Bad 2008', 'Breaking Bad 2008'],
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
    // Typographic apostrophes / curly quotes are stripped like the ASCII ones
    ['Grey’s Anatomy', 'Greys Anatomy'],
    ['Grey‘s Anatomy', 'Greys Anatomy'],
    ['The “Show”', 'The Show'],
  ])('buildTmdbSearchQuery(%j) -> %j', (input, expected) => {
    expect(buildTmdbSearchQuery(input)).toBe(expected);
  });

  it('does not mutate / depend on anything but its argument', () => {
    const title = "Grey's Anatomy (2005)";
    buildTmdbSearchQuery(title);
    expect(title).toBe("Grey's Anatomy (2005)");
  });

  // A title that is (or ends in) something year-like must still give a usable query, and the
  // year stripping agrees with normalizeShowName.
  it.each([
    ['1923', '1923'],
    ['2012', '2012'],
    ['(2018)', '(2018)'],
    ['[1999]', '[1999]'],
    ['Blade Runner 2049', 'Blade Runner 2049'],
    ['Space: 1999', 'Space 1999'],
    ['Show12345', 'Show12345'],
    ['Show (2018', 'Show (2018'],
    ['Show 2018)', 'Show 2018)'],
    ['Wonder Woman 1984', 'Wonder Woman 1984'],
  ])('year-like title %j -> %j', (input, expected) => {
    expect(buildTmdbSearchQuery(input)).toBe(expected);
  });

  it('never returns an empty query for a title with letters or digits', () => {
    for (const title of ['1923', '2012', '(2018)', '[2018]', '1984', 'X 2018', ' 2018 ']) {
      expect(buildTmdbSearchQuery(title)).not.toBe('');
    }
  });
});

describe('episodeKeyFor', () => {
  it.each([
    [0, 'e00'],
    [1, 'e01'],
    [5, 'e05'],
    [10, 'e10'],
    [105, 'e105'],
  ])('episode %d has the key %j', (episode, key) => {
    expect(episodeKeyFor(episode)).toBe(key);
  });
});

describe('unnumberedEpisodeKey', () => {
  it('gives a deterministic key derived from the filename', () => {
    const a = unnumberedEpisodeKey('Pilot.mkv');
    expect(a).toMatch(/^e00-[0-9a-z]+$/);
    expect(unnumberedEpisodeKey('Pilot.mkv')).toBe(a);
    expect(unnumberedEpisodeKey('Second.mkv')).not.toBe(a);
    expect(unnumberedEpisodeKey('pilot.mkv')).not.toBe(a);
  });

  it('distinguishes non-ASCII filenames', () => {
    expect(unnumberedEpisodeKey('第一話.mkv')).not.toBe(unnumberedEpisodeKey('第二話.mkv'));
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

describe('audioPartFiles', () => {
  const file = (filename: string) => ({ filename, path: `/book/${filename}` });

  it('keeps only audio files, dropping non-audio and extensionless entries', () => {
    const files = [
      file('cover.jpg'),
      file('notes.txt'),
      file('Part 1.mp3'),
      file('Part 2.M4B'),
      file('README'),
    ];
    expect(audioPartFiles(files).map((f) => f.filename)).toEqual(['Part 1.mp3', 'Part 2.M4B']);
  });

  it('preserves the original order and the original objects', () => {
    const a = file('b.mp3');
    const b = file('cover.png');
    const c = file('a.flac');
    const result = audioPartFiles([a, b, c]);
    expect(result).toEqual([a, c]);
    expect(result[0]).toBe(a);
    expect(result[1]).toBe(c);
  });

  it('matches extensions case-insensitively', () => {
    expect(audioPartFiles([file('A.MP3'), file('b.Opus'), file('c.mP3')])).toHaveLength(3);
  });

  it('returns an empty array when nothing is audio', () => {
    expect(audioPartFiles([file('cover.jpg'), file('episode.mkv')])).toEqual([]);
    expect(audioPartFiles([])).toEqual([]);
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
    // Underscores as separators (a regex \b never matches next to "_")
    ['Show_Name_S01E05_Episode_Title.mkv', ep('Show Name', 1, 5, 'Episode Title')],
    ['Show_Name_S01E05.mkv', ep('Show Name', 1, 5)],
    ['Show.Name.S01E05_Title.mkv', ep('Show Name', 1, 5, 'Title')],
    ['Show_Name_1x05.mkv', ep('Show Name', 1, 5)],
    ['Show_Name_10x100_Title.avi', ep('Show Name', 10, 100, 'Title')],
    ['Show_S01E05__Title.mkv', ep('Show', 1, 5, 'Title')],
    ['Bluey_2018_S01E05.mkv', { showName: 'Bluey', rawShowName: 'Bluey 2018', showYear: 2018, season: 1, episode: 5, title: '' }],
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
    // A name that is only a year is the title: kept as the show name, year 0.
    ['1923.S01E01.mkv', { showName: '1923', rawShowName: '1923', showYear: 0, season: 1, episode: 1, title: '' }],
    ['2012.1x02.mkv', { showName: '2012', rawShowName: '2012', showYear: 0, season: 1, episode: 2, title: '' }],
    // A title ending in a non-year number keeps it
    ['Blade.Runner.2049.S01E01.mkv', { showName: 'Blade Runner 2049', rawShowName: 'Blade Runner 2049', showYear: 0, season: 1, episode: 1, title: '' }],
    // In a release-style filename a bare year right before the episode tag is a release year,
    // but not after a colon/dash ("Space - 1999").
    ['Bluey 2018 S01E05.mkv', { showName: 'Bluey', rawShowName: 'Bluey 2018', showYear: 2018, season: 1, episode: 5, title: '' }],
    ['Space - 1999 - S01E01.mkv', { showName: 'Space - 1999', rawShowName: 'Space - 1999', showYear: 0, season: 1, episode: 1, title: '' }],
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

  // The token must not run into more letters/digits even when "_" is the separator.
  it.each([
    ['Show_Name_S01E05x_Title.mkv'],
    ['Show_Name_S01E1000.mkv'],
    ['Show_Name_100x01.mkv'],
  ])('still returns null for underscore name with a malformed token %j', (filename) => {
    expect(parseFilename(filename)).toBeNull();
  });

  // NOTE: a multi-episode range is parsed as the first episode with the second as the title.
  it('parses "Show.S01E05-E06.mkv" as episode 5 with title "E06" (second episode lost)', () => {
    expect(parseFilename('Show.S01E05-E06.mkv')).toEqual(ep('Show', 1, 5, 'E06'));
  });

  // Limitations of parseFilename itself. In every case the scanner then falls back to
  // parseFromPath (see FileScanner.parseMediaFile), which does extract S01E05 / 1x05 forms.
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

    it('treats a bare year in a folder name as part of the show name', () => {
      expect(parseFromPath('ep.mkv', ['Wonder Woman 1984', 'Season 1'])).toMatchObject({
        showName: 'Wonder Woman 1984',
        showYear: 0,
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
      ['S01', 1],
      ['S2', 2],
      ['s05', 5],
      ['Show S02', 2],
      ['Series 3', 3],
      ['series2', 2],
      ['Season 0', 0],
      // Fallback: the first standalone run of 1-3 digits
      ['Staffel 2', 2],
      ['Book 7', 7],
      ['3', 3],
      ['01', 1],
      ['Disc 2', 2],
      ['Disc 2 Season 1', 1], // "Season N" still wins
      ['Season 1 Part 2', 1],
      // Specials follow the Plex/Kodi convention: season 0
      ['Specials', 0],
      ['Special', 0],
      ['specials', 0],
      ['Specials (2019)', 0],
      // No usable number defaults to season 1
      ['Extras', 1],
      ['', 1],
      // A 4-digit number is a year, never a season
      ['Show 2018 Extras', 1],
      ['2019', 1],
      ['Season 2019', 1],
      ['Show (2018)', 1],
    ])('season folder %j -> season %d', (folder, season) => {
      expect(parseFromPath('ep.mkv', ['Show', folder])?.season).toBe(season);
    });

    it('uses the season from the filename (SxxExx / NxNN) over the folder', () => {
      expect(parseFromPath('S02E05.mkv', ['Show'])).toMatchObject({ season: 2, episode: 5 });
      expect(parseFromPath('S02E05.mkv', ['Show', 'Extras'])).toMatchObject({ season: 2, episode: 5 });
      expect(parseFromPath('S02E05.mkv', ['Show', 'Season 2'])).toMatchObject({ season: 2, episode: 5 });
      expect(parseFromPath('S03E05.mkv', ['Show', 'Season 1'])).toMatchObject({ season: 3, episode: 5 });
      expect(parseFromPath('3x05.mkv', ['Show'])).toMatchObject({ season: 3, episode: 5 });
    });

    it('falls back to the folder season, then season 1, when the filename has no season', () => {
      expect(parseFromPath('E05.mkv', ['Show', 'Season 4'])?.season).toBe(4);
      expect(parseFromPath('E05.mkv', ['Show', 'Specials'])?.season).toBe(0);
      expect(parseFromPath('E05.mkv', ['Show'])?.season).toBe(1);
    });
  });

  describe('episode number from the filename', () => {
    it.each([
      ['Show.E05.mkv', 5],
      ['Show.e5.mkv', 5],
      ['Show E5 Title.mkv', 5],
      ['Show.EP12.mkv', 12],
      ['Show.ep7.mkv', 7],
      ['E123.mkv', 123],
      ['Show-E05-Title.mkv', 5],
      ['Show (E05).mkv', 5],
      ['Show_E05_Title.mkv', 5],
      // "Episode N" / "Ep N" with an optional separator
      ['Show - Ep 12.mkv', 12],
      ['Ep 5.mkv', 5],
      ['Ep.05.mkv', 5],
      ['Ep05.mkv', 5],
      ['Episode 5.mkv', 5],
      ['Episode05.mkv', 5],
      ['episode_12 - Title.mkv', 12],
      // SxxExx / NxNN with no show name in the filename (parseFilename returns null)
      ['S01E05.mkv', 5],
      ['S01E05.Episode.Title.mkv', 5],
      ['s01.e05.mkv', 5],
      ['Show.Name.S01E05.mkv', 5],
      ['1x05.mkv', 5],
      // A leading 1-3 digit number
      ['01.mkv', 1],
      ['1.mkv', 1],
      ['01 - Title.mkv', 1],
      ['01.Title.mkv', 1],
      ['05_Title.mkv', 5],
      ['5. Title.mkv', 5],
      ['123.mkv', 123],
      ['00.mkv', 0],
    ])('%j -> episode %d', (filename, episode) => {
      expect(parseFromPath(filename, ['Show', 'Season 1'])?.episode).toBe(episode);
    });

    it.each([
      ['Show Name Title.mkv'],
      ['Show.E1000.mkv'],
      ['Show.Episode1000.mkv'],
      // 4-digit numbers are years, not episodes
      ['2019.mkv'],
      ['2019 - Title.mkv'],
      ['1080.mkv'],
      // Numbers buried in a title or glued to a word are not episodes
      ['Room 101.mkv'],
      ['Title 05.mkv'],
      ['Se7en.mkv'],
      ['3rd Rock.mkv'],
      ['720p.mkv'],
      ['Pilot Part 2.mkv'],
      ['Movie.1920x1080.mkv'],
    ])('does not extract an episode number from %j (falls back to 0)', (filename) => {
      expect(parseFromPath(filename, ['Show', 'Season 1'])?.episode).toBe(0);
    });

    it('does not read a leading number as the episode when it starts the show name', () => {
      expect(parseFromPath('2 Broke Girls - Pilot.mkv', ['2 Broke Girls', 'Season 1'])?.episode).toBe(0);
      expect(parseFromPath('2 Broke Girls - E05.mkv', ['2 Broke Girls', 'Season 1'])?.episode).toBe(5);
      expect(parseFromPath('02 - Pilot.mkv', ['2 Broke Girls', 'Season 1'])?.episode).toBe(2);
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
