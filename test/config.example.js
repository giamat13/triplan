// העתיקו את הקובץ הזה לשם config.js (לא ל-git, ר' _gitignore) ומלאו את
// הערכים האמיתיים מקונסולת Firebase:
// - firebaseConfig: Project settings > General > Your apps > Web app
// - APPCHECK_SITE_KEY: ה-Site key (לא ה-Secret key!) מ-reCAPTCHA v3,
//   שנרשם ב-Firebase console > Security > App Check > Apps

window.__FIREBASE_CONFIG__ = {
  apiKey: "REPLACE_ME",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.firebasestorage.app",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:xxxxxxxxxxxxxxxxxxxxxx",
  measurementId: "G-XXXXXXXXXX"
};

window.__APPCHECK_SITE_KEY__ = "REPLACE_ME_RECAPTCHA_SITE_KEY";
