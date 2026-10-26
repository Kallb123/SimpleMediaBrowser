import type { sortOrders } from '@/store/settingsReducer';

/** Sort orders offered in the Settings dropdown and the optional sidebar dropdown. */
export const sortOrderOptions: { id: sortOrders; label: string }[] = [
  {id: 'alphabetical', label: 'A > Z'},
  {id: 'reverseAlphabetical', label: 'Z > A'},
  {id: 'lastOpened', label: 'Last opened'},
  {id: 'recentlyAdded', label: 'Recently added'},
];
