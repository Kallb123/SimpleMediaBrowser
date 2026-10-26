import { clearSelection, toggleSelection, type Selection } from '@/contexts/EditModeContext';

const NONE: Selection = { owner: null, items: new Set() };

describe('EditModeContext selection ownership', () => {
  it('records the owner of a selection', () => {
    const s = toggleSelection(NONE, 'episode:a', 'route-1');
    expect(s.owner).toBe('route-1');
    expect(Array.from(s.items)).toEqual(['episode:a']);
  });

  it('adds to and toggles off within the same owner', () => {
    let s = toggleSelection(NONE, 'show:a', 'route-1');
    s = toggleSelection(s, 'show:b', 'route-1');
    expect(Array.from(s.items)).toEqual(['show:a', 'show:b']);
    s = toggleSelection(s, 'show:a', 'route-1');
    expect(Array.from(s.items)).toEqual(['show:b']);
  });

  it('starts a fresh selection when a different owner selects', () => {
    const s = toggleSelection(toggleSelection(NONE, 'show:a', 'route-1'), 'episode:b', 'route-2');
    expect(s.owner).toBe('route-2');
    expect(Array.from(s.items)).toEqual(['episode:b']);
  });

  it('clears unconditionally without an owner', () => {
    const s = clearSelection(toggleSelection(NONE, 'show:a', 'route-1'));
    expect(s.items.size).toBe(0);
    expect(s.owner).toBeNull();
  });

  it('only clears for the owner that still holds the selection', () => {
    const s = toggleSelection(NONE, 'show:a', 'route-1');
    expect(clearSelection(s, 'route-2')).toBe(s);
    expect(clearSelection(s, 'route-1').items.size).toBe(0);
  });
});
