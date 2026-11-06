// Firebase web config for sharing between phones. These values are not
// secrets: Firebase web apps always ship them to the browser. What protects
// the data is firestore.rules, which only lets members of a trip read it.
// Leave this as null to keep everything on each phone only.
window.FIREBASE_CONFIG = null;
