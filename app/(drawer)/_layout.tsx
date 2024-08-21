import { useColorScheme } from "@/hooks/useColorScheme";
import { Drawer } from 'expo-router/drawer';

export default function DrawerLayout() {
    const colorScheme = useColorScheme();
  
    return (
        <Drawer>
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
        </Drawer>
    );
  }