module.exports = {
  // Root Agent is a private build without Firebase project configuration.
  // Do not autolink Firebase App Check on Android: it calls
  // FirebaseApp.getInstance() during startup and crashes the app.
  dependencies: {
    '@react-native-firebase/app-check': {
      platforms: {
        android: null,
      },
    },
  },
  project: {
    ios: {},
    android: {},
  },
  assets: ['./src/assets/fonts'],
};
