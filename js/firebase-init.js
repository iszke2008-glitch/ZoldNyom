// ---------------------------------------------
// Firebase inicializálás — tanító adatok gyűjtéséhez (fotó + kategória).
// A feltöltés csak akkor történik meg, ha a felhasználó a Profil oldalon
// kifejezetten hozzájárult (lásd js/app.js — trainingConsent).
// ---------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyDsws4Vu52rPjgYuoSp6AKpmVmMk1PK5iA",
  authDomain: "zoldnyom.firebaseapp.com",
  projectId: "zoldnyom",
  storageBucket: "zoldnyom.firebasestorage.app",
  messagingSenderId: "89648747746",
  appId: "1:89648747746:web:a76adb50a30f6f6b3cbabb"
};

firebase.initializeApp(firebaseConfig);

const fbAuth = firebase.auth();
const fbDb = firebase.firestore();
const fbStorage = firebase.storage();

// Anonim bejelentkezés — nincs regisztráció, csak egy egyedi, névtelen azonosító
// kell ahhoz, hogy a Firestore/Storore biztonsági szabályok tudják, hogy nem
// egy teljesen ismeretlen forrásból jön az írás.
const fbReady = fbAuth.signInAnonymously().catch((e) => {
  console.warn('Firebase anonim bejelentkezés sikertelen (a tanító adat feltöltés emiatt kimaradhat):', e);
});
