import { useColorScheme as useNativeColorScheme } from 'react-native';
import { useSelector } from 'react-redux';
import { selectAppColorScheme } from '@/store/settingsReducer';

export function useColorScheme(): 'light' | 'dark' {
	const nativeScheme = useNativeColorScheme() === 'dark' ? 'dark' : 'light';
	const appColorScheme = useSelector(selectAppColorScheme);
	if (appColorScheme === 'system') return nativeScheme;
	return appColorScheme;
}
