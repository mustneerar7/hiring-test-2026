// React Native Firebase initializes the default app natively via google-services.json
// (Android) and GoogleService-Info.plist (iOS). We just need to import the module
// so the native SDK is loaded before any other Firebase service is used.
import firebase from '@react-native-firebase/app';

// Re-export for convenience — other modules can `import '@/services/firebase'`
// to guarantee the native SDK is loaded before they call auth(), firestore(), etc.
export default firebase;
