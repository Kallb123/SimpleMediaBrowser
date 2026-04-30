import { useColorScheme } from "@/hooks/useColorScheme";
import { Drawer } from 'expo-router/drawer';
import { Colors } from '@/constants/Colors';

export default function DrawerLayout() {
    const colorScheme = useColorScheme();
    const theme = (colorScheme ?? 'light') as 'light' | 'dark';
  
    return (
        <Drawer screenOptions={{
            headerTintColor: Colors[theme].text,
            headerStyle: { backgroundColor: Colors[theme].background },
        }}>
            <Drawer.Screen
            name="index" // This is the name of the page and must match the url from root
            options={{
                drawerLabel: 'Home',
                title: "",
            }}
            />
            <Drawer.Screen
            name="settingsprompt" // This is the name of the page and must match the url from root
            options={{
                drawerLabel: 'Settings',
                title: "",
            }}
            />
            <Drawer.Screen
            name="logs" // Debug log viewer
            options={{
                drawerLabel: '🪲 Debug Logs',
                title: "Debug Logs",
            }}
            />
        </Drawer>
    );
  }