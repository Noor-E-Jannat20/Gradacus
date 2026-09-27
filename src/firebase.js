import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAG5Jez19bPq395Mf3dukdBP1jHZz71Nqs',
  authDomain: 'gradacus-fd082.firebaseapp.com',
  projectId: 'gradacus-fd082',
  storageBucket: 'gradacus-fd082.firebasestorage.app',
  messagingSenderId: '160033318436',
  appId: '1:160033318436:web:2bdcd1bd7e33b5e0245ab1'
};

export let auth = null;
export let db = null;

try {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(err => {
    console.error('Could not set session persistence:', err);
  });
  db = firebase.firestore();
} catch (err) {
  console.error('Firebase failed to initialise:', err);
}

export { firebase };
