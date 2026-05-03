# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Building

### Prequisites

Follow guide: https://docs.expo.dev/get-started/set-up-your-environment/?platform=android&device=physical&mode=development-build&buildEnv=local#set-up-an-android-device-with-a-development-build

Windows steps:

1. Install NodeJS
1. Install `npm i -g eas-cli` (maybe optional if using gradlew)
1. Install Java JDK `choco install -y microsoft-openjdk17`
1. Install Android Studio and install specific components
1. Set up environment variable `ANDROID_HOME` and add the platform tools to PATH
1. Check `adb --version`
1. `eas build:configure`

### Build

1. `npx expo prebuild`
1. `cd android`
1. `.\gradlew assembleRelease`

