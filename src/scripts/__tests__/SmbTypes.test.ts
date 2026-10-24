import { SMB_THUMB_REGEX, smbThumbFilename } from '@/scripts/SmbTypes';
import { unnumberedEpisodeKey } from '@/scripts/libraryUtils';

describe('SMB_THUMB_REGEX', () => {
  const hashKey = unnumberedEpisodeKey('Bonus Feature.mkv');

  it.each([
    ['s01', 'e01'],
    ['s00', 'e00'],
    ['s02', 'e105'],
    ['s01', hashKey],
    ['s01', `${hashKey}-2`],
  ])('round-trips the filename written for %s/%s', (seasonKey, episodeKey) => {
    const match = smbThumbFilename(seasonKey, episodeKey).match(SMB_THUMB_REGEX);
    expect(match?.[1]).toBe(seasonKey);
    expect(match?.[2]).toBe(episodeKey);
  });

  it.each([
    'smb_thumb_s01.jpg',
    'smb_thumb_s01e1.jpg',
    'smb_thumb_s01e01.png',
    'smb_thumb_s01e01-.jpg',
    'thumb_s01e01.jpg',
  ])('does not match %j', (filename) => {
    expect(filename).not.toMatch(SMB_THUMB_REGEX);
  });
});
