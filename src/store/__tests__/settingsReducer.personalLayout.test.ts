import reducer, { selectDefaultPage, selectPersonalLayout, setDefaultPage, setPersonalLayout } from '../settingsReducer';
import type { RootState } from '../store';

const init = () => reducer(undefined, { type: '@@INIT' });
const root = (settingsReducer: unknown) => ({ settingsReducer }) as unknown as RootState;

describe('settingsReducer personalLayout', () => {
  it('defaults to the folder tree', () => {
    expect(init().personalLayout).toBe('folders');
    expect(selectPersonalLayout(root(init()))).toBe('folders');
  });

  it('setPersonalLayout switches between folders and a flat list', () => {
    let s = reducer(init(), setPersonalLayout('flat'));
    expect(selectPersonalLayout(root(s))).toBe('flat');
    s = reducer(s, setPersonalLayout('folders'));
    expect(selectPersonalLayout(root(s))).toBe('folders');
  });

  it('selector falls back to folders for persisted state that predates the setting or holds a stale value', () => {
    expect(selectPersonalLayout(root({ dataSource: 'tmdb' }))).toBe('folders');
    expect(selectPersonalLayout(root({ personalLayout: 'grid' }))).toBe('folders');
  });

  it('personal is a valid default page', () => {
    expect(selectDefaultPage(root(reducer(init(), setDefaultPage('personal'))))).toBe('personal');
  });
});
